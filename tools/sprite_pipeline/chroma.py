"""Chroma-key removal shared by QA and the packer.

Each frame's key colour is measured from its own border, because generators
rarely paint the exact hex they were asked for and may pick green for one frame
and blue for the next. Pixels close to that colour become transparent. Subject
pixels in a band next to the background are unmixed from the key, so edges keep
their own colour instead of a green or blue fringe. Pixels deeper inside the
subject are never touched.

Unmixing models an edge pixel as `observed = (1 - k) * subject + k * key`. The
subject colour is taken from the nearest interior pixel and k is the projection
of the observed colour onto the subject→key line. Where no interior colour is in
reach, or it is too close to the key, k falls back to the pixel's key tint.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

# RGB distance below which a pixel counts as background.
KEY_DISTANCE = 96.0
# Subject pixels within this many pixels of the background are unmixed.
EDGE_BAND_PX = 3
# Beyond that band, key-tinted pixels joined to the background through other
# tinted pixels are unmixed too: a glow painted over the screen fades across
# tens of pixels, not three.
GLOW_MIN_MIX = 0.15
GLOW_MAX_PX = 96
# Share of border pixels that must sit near the measured key colour.
MIN_BORDER_SHARE = 0.5
# Minimum channel spread for a colour to count as a chroma key (not white/grey/black).
MIN_KEY_SATURATION = 64.0
# Keyed alpha below this is snapped to fully transparent.
MIN_ALPHA = 8 / 255
# Below this RGB distance between subject and key, the projection is unstable.
MIN_SUBJECT_KEY_DISTANCE = 64.0


class ChromaKeyError(ValueError):
    """The frame has no usable chroma-key background."""


@dataclass(frozen=True)
class KeyAnalysis:
    """Per-pixel masks of a frame measured against its key colour."""

    key: np.ndarray  # (3,) float32 RGB
    background: np.ndarray  # (H, W) bool, pixels removed outright
    mix: np.ndarray  # (H, W) float32, share of key colour in each pixel, 0..1


def border_pixels(array: np.ndarray) -> np.ndarray:
    """Return the outermost ring of pixels as an (N, C) array."""
    return np.concatenate([array[0], array[-1], array[1:-1, 0], array[1:-1, -1]])


def has_transparent_background(rgba: np.ndarray) -> bool:
    """True when most of the border is already transparent (a pre-keyed frame)."""
    return float((border_pixels(rgba)[:, 3] < 255).mean()) >= MIN_BORDER_SHARE


def key_family(key: np.ndarray) -> str:
    """Name the key's colour family for reports: green, blue, magenta or other."""
    channels = tuple(bool(c) for c in _key_channels(key))
    return {(False, True, False): "green", (False, False, True): "blue", (True, False, True): "magenta"}.get(
        channels, "other"
    )


def measure_key(rgb: np.ndarray) -> np.ndarray:
    """Measure the background key colour from the frame border.

    Raises ChromaKeyError when the border is not dominated by one saturated colour.
    """
    border = border_pixels(rgb).astype(np.float32)
    bins = border.astype(np.int32) // 16
    codes = bins[:, 0] * 256 + bins[:, 1] * 16 + bins[:, 2]
    centre = border[codes == np.bincount(codes).argmax()].mean(axis=0)
    near = border[np.linalg.norm(border - centre, axis=1) < KEY_DISTANCE / 2]
    share = len(near) / len(border)
    if share < MIN_BORDER_SHARE:
        raise ChromaKeyError(f"border is not a solid background ({share:.0%} of border pixels share one colour)")
    key = np.median(near, axis=0).astype(np.float32)
    if float(key.max() - key.min()) < MIN_KEY_SATURATION:
        rgb_text = ",".join(str(round(float(c))) for c in key)
        raise ChromaKeyError(f"border colour ({rgb_text}) is not a chroma key")
    return key


def analyse(rgb: np.ndarray, key: np.ndarray) -> KeyAnalysis:
    """Classify each pixel as background and measure how much key colour it carries."""
    pixels = rgb.astype(np.float32)
    background = np.linalg.norm(pixels - key, axis=-1) < KEY_DISTANCE
    channels = _key_channels(key)
    tint = pixels[..., channels].mean(axis=-1) - pixels[..., ~channels].mean(axis=-1)
    key_tint = float(key[channels].mean() - key[~channels].mean())
    mix = np.clip(tint / key_tint, 0.0, 1.0).astype(np.float32)
    return KeyAnalysis(key=key, background=background, mix=mix)


def subject_edge(background: np.ndarray, width: int = 1) -> np.ndarray:
    """Subject pixels within `width` pixels (4-connected) of the background or image edge."""
    return _grow(np.pad(background, 1, constant_values=True), width)[1:-1, 1:-1] & ~background


def unmix_band(analysis: KeyAnalysis) -> np.ndarray:
    """Subject pixels whose colour is solved against the key: the edge band plus any glow."""
    tinted = analysis.mix >= GLOW_MIN_MIX
    glow = _grow(analysis.background, GLOW_MAX_PX, within=tinted | analysis.background)
    return (subject_edge(analysis.background, EDGE_BAND_PX) | glow) & ~analysis.background


def remove_key(rgba: np.ndarray, analysis: KeyAnalysis) -> np.ndarray:
    """Return a uint8 RGBA array with the key removed and the edge band unmixed."""
    rgb = rgba[..., :3].astype(np.float32)
    alpha = rgba[..., 3].astype(np.float32) / 255
    band = unmix_band(analysis)
    if band.any():
        k = _key_share(rgb, band, analysis)
        observed = rgb[band]
        rgb[band] = np.clip((observed - k[:, None] * analysis.key) / np.maximum(1 - k, 1e-3)[:, None], 0, 255)
        alpha[band] *= 1 - k
    alpha[analysis.background] = 0
    alpha[alpha < MIN_ALPHA] = 0
    rgb[alpha == 0] = 0

    out = np.empty(rgba.shape, dtype=np.uint8)
    out[..., :3] = np.rint(rgb)
    out[..., 3] = np.rint(alpha * 255)
    return out


def _key_share(rgb: np.ndarray, band: np.ndarray, analysis: KeyAnalysis) -> np.ndarray:
    """Share of key colour k for each band pixel, in band order."""
    interior = ~band & ~analysis.background
    subject, found = _nearest_colour(rgb, interior, band)
    key = analysis.key
    observed = rgb[band]
    k = analysis.mix[band].copy()

    towards_key = key - subject[band]
    length_sq = (towards_key**2).sum(axis=1)
    usable = found[band] & (length_sq >= MIN_SUBJECT_KEY_DISTANCE**2)
    projected = ((observed - subject[band]) * towards_key).sum(axis=1) / np.maximum(length_sq, 1.0)
    k[usable] = projected[usable]
    return np.clip(k, 0.0, 1.0)


def _nearest_colour(rgb: np.ndarray, source: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Spread `source` colours into `target` pixels, one 4-connected step at a time.

    Returns the propagated colours and the mask of pixels that received one.
    Work is limited to the bounding box of `target` plus one pixel.
    """
    ys, xs = np.nonzero(target)
    y0, y1 = max(ys.min() - 1, 0), min(ys.max() + 2, rgb.shape[0])
    x0, x1 = max(xs.min() - 1, 0), min(xs.max() + 2, rgb.shape[1])
    want = target[y0:y1, x0:x1]
    have = source[y0:y1, x0:x1].copy()
    colour = np.where(have[..., None], rgb[y0:y1, x0:x1], 0.0).astype(np.float32)

    for _ in range(GLOW_MAX_PX + EDGE_BAND_PX):
        need = want & ~have
        if not need.any():
            break
        total = np.zeros_like(colour)
        count = np.zeros(have.shape, dtype=np.float32)
        weighted = colour * have[..., None]
        for axis, step in ((0, 1), (0, -1), (1, 1), (1, -1)):
            total += _shift(weighted, step, axis)
            count += _shift(have.astype(np.float32), step, axis)
        newly = need & (count > 0)
        if not newly.any():
            break
        colour[newly] = total[newly] / count[newly][:, None]
        have |= newly

    full_colour = np.zeros_like(rgb, dtype=np.float32)
    full_found = np.zeros(target.shape, dtype=bool)
    full_colour[y0:y1, x0:x1] = colour
    full_found[y0:y1, x0:x1] = have & want
    return full_colour, full_found


def _shift(array: np.ndarray, step: int, axis: int) -> np.ndarray:
    """Shift by one pixel along an axis, filling the vacated edge with zeros."""
    out = np.zeros_like(array)
    if axis == 0:
        if step > 0:
            out[1:] = array[:-1]
        else:
            out[:-1] = array[1:]
    elif step > 0:
        out[:, 1:] = array[:, :-1]
    else:
        out[:, :-1] = array[:, 1:]
    return out


def key_image(image: Image.Image) -> tuple[Image.Image, np.ndarray | None]:
    """Remove the chroma-key background from one frame.

    Returns the keyed RGBA image and the key colour used, or None when the frame
    already had a transparent background and was returned unchanged.
    """
    rgba = np.asarray(image.convert("RGBA"))
    if has_transparent_background(rgba):
        return Image.fromarray(rgba), None
    key = measure_key(rgba[..., :3])
    return Image.fromarray(remove_key(rgba, analyse(rgba[..., :3], key))), key


def _grow(mask: np.ndarray, steps: int, within: np.ndarray | None = None) -> np.ndarray:
    """4-connected dilation by `steps` pixels, optionally confined to `within`."""
    grown = mask.copy()
    for _ in range(steps):
        step = grown.copy()
        step[1:] |= grown[:-1]
        step[:-1] |= grown[1:]
        step[:, 1:] |= grown[:, :-1]
        step[:, :-1] |= grown[:, 1:]
        if within is not None:
            step &= within
        if np.array_equal(step, grown):
            break
        grown = step
    return grown


def _key_channels(key: np.ndarray) -> np.ndarray:
    """Channels that carry the key colour: those at least half as bright as the brightest."""
    return np.asarray(key) >= float(np.max(key)) * 0.5
