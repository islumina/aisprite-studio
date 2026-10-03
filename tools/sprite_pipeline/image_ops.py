"""Image measurements for the sprite pipeline.

Every frame is keyed with the same `chroma` module the packer uses, so QA
measures what will actually ship. No model or network calls here.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from . import chroma

log = logging.getLogger(__name__)

# Alpha at or above this counts as part of the subject for coverage and centroid.
OPAQUE_ALPHA = 128


@dataclass(frozen=True)
class FrameAnalysis:
    """Measurements of one frame after chroma keying."""

    width: int
    height: int
    coverage: float  # share of pixels that are subject
    centroid: tuple[float, float] | None  # subject centroid in pixels
    key: tuple[int, int, int] | None  # measured key colour, None for pre-keyed frames
    key_error: str | None  # why the frame could not be keyed, if it could not


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
    """Key one frame and measure subject coverage and centroid. None if unreadable."""
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
            alpha = rgba[..., 3]
        else:
            key = chroma.measure_key(rgba[..., :3])
            alpha = chroma.remove_key(rgba, chroma.analyse(rgba[..., :3], key))[..., 3]
    except chroma.ChromaKeyError as exc:
        return FrameAnalysis(width, height, 0.0, None, None, str(exc))

    subject = alpha >= OPAQUE_ALPHA
    coverage = float(subject.mean())
    centroid = None
    if subject.any():
        ys, xs = np.nonzero(subject)
        centroid = (float(xs.mean()), float(ys.mean()))
    key_rgb = None if key is None else tuple(int(round(float(c))) for c in key)
    return FrameAnalysis(width, height, coverage, centroid, key_rgb, None)


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
