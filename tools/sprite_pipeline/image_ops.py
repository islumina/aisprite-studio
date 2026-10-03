"""Image measurements for the sprite pipeline.

Every frame is keyed with the same `chroma` module the packer uses, so QA
measures what will actually ship. No model or network calls here.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

from . import chroma

log = logging.getLogger(__name__)

# Alpha at or above this counts as part of the subject for coverage and centroid.
OPAQUE_ALPHA = 128
# Side of the premultiplied thumbnail used to compare frames of one animation.
THUMBNAIL_PX = 64
# Subject pixels this close to the canvas edge mean the subject is cropped.
EDGE_MARGIN_PX = 2
# Levels per RGB channel in the subject colour histogram (4 -> 64 bins).
HISTOGRAM_LEVELS = 4
# Colour families named in repair hints, in hue order, then the achromatic ones.
COLOUR_FAMILIES = ("red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "black", "grey", "white")
# Upper hue bound (degrees) of each chromatic family; red wraps around 345.
_HUE_EDGES = (15, 45, 70, 160, 200, 260, 290, 345)


@dataclass(frozen=True)
class FrameAnalysis:
    """Measurements of one frame after chroma keying."""

    width: int
    height: int
    coverage: float  # share of pixels that are subject
    centroid: tuple[float, float] | None  # subject centroid in pixels
    key: tuple[int, int, int] | None  # measured key colour, None for pre-keyed frames
    key_error: str | None  # why the frame could not be keyed, if it could not
    bbox: tuple[int, int, int, int] | None = None  # subject box (x0, y0, x1, y1), end-exclusive
    edge_sides: tuple[str, ...] = ()  # canvas sides the subject touches
    # Premultiplied RGBA thumbnail, (THUMBNAIL_PX, THUMBNAIL_PX, 4) float32 in 0..1.
    thumbnail: np.ndarray | None = field(default=None, compare=False, repr=False)
    # Share of subject pixels per RGB histogram bin, sums to 1.
    histogram: np.ndarray | None = field(default=None, compare=False, repr=False)
    # Share of subject pixels per COLOUR_FAMILIES entry, sums to 1.
    colour_families: np.ndarray | None = field(default=None, compare=False, repr=False)


def image_format(path: Path) -> str | None:
    """Return the decoded format (e.g. "PNG", "JPEG") of a readable, non-empty image file."""
    if not path.is_file() or path.stat().st_size == 0:
        return None
    try:
        with Image.open(path) as img:
            img.verify()
            return img.format
    except Exception:
        return None


def get_dimensions(path: Path) -> tuple[int, int] | None:
    """Return (width, height) of an image, or None if unreadable."""
    try:
        with Image.open(path) as img:
            return img.size
    except Exception:
        return None


def analyse_frame(path: Path) -> FrameAnalysis | None:
    """Key one frame and measure the subject. None if unreadable.

    One keyed read feeds every measurement: coverage and centroid for the frame
    checks, and box, edge contact, thumbnail and colours for the sequence checks.
    """
    try:
        with Image.open(path) as img:
            rgba = np.asarray(img.convert("RGBA"))
    except Exception:
        log.exception("Cannot read frame: %s", path)
        return None

    height, width = rgba.shape[:2]
    key = None
    try:
        if chroma.has_transparent_background(rgba):
            keyed = rgba
        else:
            key = chroma.measure_key(rgba[..., :3])
            keyed = chroma.remove_key(rgba, chroma.analyse(rgba[..., :3], key))
    except chroma.ChromaKeyError as exc:
        return FrameAnalysis(width, height, 0.0, None, None, str(exc))

    subject = keyed[..., 3] >= OPAQUE_ALPHA
    coverage = float(subject.mean())
    centroid = None
    bbox = None
    if subject.any():
        ys, xs = np.nonzero(subject)
        centroid = (float(xs.mean()), float(ys.mean()))
        bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    key_rgb = None if key is None else tuple(int(round(float(c))) for c in key)
    pixels = keyed[subject][:, :3]
    return FrameAnalysis(
        width,
        height,
        coverage,
        centroid,
        key_rgb,
        None,
        bbox=bbox,
        edge_sides=edge_contact(subject),
        thumbnail=premultiplied_thumbnail(keyed),
        histogram=colour_histogram(pixels),
        colour_families=colour_family_shares(pixels),
    )


def edge_contact(subject: np.ndarray, margin: int = EDGE_MARGIN_PX) -> tuple[str, ...]:
    """Canvas sides whose outer `margin` pixels contain subject pixels."""
    sides = (
        ("top", subject[:margin]),
        ("bottom", subject[-margin:]),
        ("left", subject[:, :margin]),
        ("right", subject[:, -margin:]),
    )
    return tuple(name for name, strip in sides if strip.any())


def premultiplied_thumbnail(rgba: np.ndarray, size: int = THUMBNAIL_PX) -> np.ndarray:
    """Box-filtered premultiplied RGBA thumbnail in 0..1.

    Premultiplying first keeps the colour of fully transparent pixels, which
    pre-keyed frames may leave arbitrary, out of the comparison.
    """
    values = rgba.astype(np.float32) / 255
    alpha = values[..., 3:4]
    premultiplied = np.concatenate([values[..., :3] * alpha, alpha], axis=-1)
    channels = [
        np.asarray(Image.fromarray(premultiplied[..., c]).resize((size, size), Image.BOX), dtype=np.float32)
        for c in range(4)
    ]
    return np.stack(channels, axis=-1)


def frame_difference(a: np.ndarray, b: np.ndarray) -> float:
    """Mean absolute difference of two premultiplied thumbnails over their subject area.

    Normalising by the union of both subjects keeps the measure independent of
    how much of the canvas the subject fills. 0 means identical.
    """
    area = float(np.maximum(a[..., 3], b[..., 3]).sum())
    if area <= 0:
        return 0.0
    return float(np.abs(a - b).sum() / (4 * area))


def colour_histogram(pixels: np.ndarray, levels: int = HISTOGRAM_LEVELS) -> np.ndarray:
    """Share of (N, 3) uint8 RGB pixels in each of `levels`**3 colour bins."""
    bins = pixels.astype(np.int32) * levels // 256
    codes = (bins[:, 0] * levels + bins[:, 1]) * levels + bins[:, 2]
    counts = np.bincount(codes, minlength=levels**3).astype(np.float64)
    return counts / max(float(counts.sum()), 1.0)


def histogram_overlap(a: np.ndarray, b: np.ndarray) -> float:
    """Histogram intersection of two normalised histograms: 1 identical, 0 disjoint."""
    return float(np.minimum(a, b).sum())


def colour_family_shares(pixels: np.ndarray) -> np.ndarray:
    """Share of (N, 3) uint8 RGB pixels in each COLOUR_FAMILIES entry.

    Dark pixels are black, unsaturated ones grey or white, the rest are named by hue.
    """
    shares = np.zeros(len(COLOUR_FAMILIES), dtype=np.float64)
    if len(pixels) == 0:
        return shares
    rgb = pixels.astype(np.float32) / 255
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    high = rgb.max(axis=1)
    spread = high - rgb.min(axis=1)
    saturation = spread / np.maximum(high, 1e-6)

    hue = np.zeros_like(high)
    coloured = spread > 0
    red_max = coloured & (high == r)
    green_max = coloured & (high == g) & ~red_max
    blue_max = coloured & ~red_max & ~green_max
    hue[red_max] = ((g - b)[red_max] / spread[red_max]) % 6
    hue[green_max] = (b - r)[green_max] / spread[green_max] + 2
    hue[blue_max] = (r - g)[blue_max] / spread[blue_max] + 4
    family = np.digitize(hue * 60, _HUE_EDGES) % len(_HUE_EDGES)

    achromatic = saturation < 0.25
    family[achromatic & (high >= 0.75)] = COLOUR_FAMILIES.index("white")
    family[achromatic & (high < 0.75)] = COLOUR_FAMILIES.index("grey")
    family[high < 0.2] = COLOUR_FAMILIES.index("black")
    counts = np.bincount(family, minlength=len(COLOUR_FAMILIES)).astype(np.float64)
    return counts / float(counts.sum())


def centroid_drift(
    a: tuple[float, float],
    b: tuple[float, float],
    frame_size: int,
    threshold: float = 0.05,
) -> dict:
    """Compare two subject centroids; fail when they move more than `threshold` of the frame."""
    drift_px = float(np.hypot(a[0] - b[0], a[1] - b[1]))
    drift_ratio = drift_px / frame_size
    ok = drift_ratio <= threshold
    return {
        "pass": ok,
        "drift_px": round(drift_px, 1),
        "drift_ratio": round(drift_ratio, 4),
        "detail": "OK" if ok else f"Centroid drift {drift_px:.1f}px ({drift_ratio:.1%} of frame)",
    }
