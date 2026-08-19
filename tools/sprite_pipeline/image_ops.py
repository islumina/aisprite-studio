"""Image utility functions for the sprite pipeline.

Pillow-based operations: dimension check, alpha coverage, PNG validation.
No model or network calls here — pure local image processing.
"""

from __future__ import annotations

import logging
from pathlib import Path

from PIL import Image

log = logging.getLogger(__name__)


def _is_chroma_key(r: int, g: int, b: int, threshold: int = 100, margin: int = 30) -> bool:
    """Return whether an RGB pixel belongs to the supported green/blue key."""
    return (
        (g > threshold and g > r + margin and g > b + margin)
        or (b > threshold and b > r + margin and b > g + margin)
    )


def is_valid_png(path: Path) -> bool:
    """Check if a file is a readable PNG with non-zero size."""
    if not path.exists() or path.stat().st_size == 0:
        return False
    try:
        with Image.open(path) as img:
            img.verify()
        return True
    except Exception:
        return False


def get_dimensions(path: Path) -> tuple[int, int] | None:
    """Return (width, height) of an image, or None if unreadable."""
    try:
        with Image.open(path) as img:
            return img.size
    except Exception:
        return None


def alpha_coverage(path: Path) -> float | None:
    """Fraction of non-transparent, non-green-screen pixels.

    Returns a float 0.0-1.0, or None if the image is unreadable.
    """
    try:
        with Image.open(path) as img:
            img = img.convert("RGBA")
            width, height = img.size
            pixels = width * height
            if pixels == 0:
                return None
            non_green_non_trans = 0
            pixel_data = img.get_flattened_data() if hasattr(img, "get_flattened_data") else img.getdata()
            for r, g, b, a in pixel_data:
                if a == 0:
                    continue
                if _is_chroma_key(r, g, b):
                    continue
                non_green_non_trans += 1
            return non_green_non_trans / pixels
    except Exception:
        return None


def ensure_size(path: Path, target_w: int, target_h: int) -> bool:
    """Check if an image matches the expected dimensions exactly."""
    dims = get_dimensions(path)
    if dims is None:
        return False
    return dims[0] == target_w and dims[1] == target_h


def detect_edge_halo(path: Path, green_threshold: int = 100, halo_limit: float = 0.30) -> dict | None:
    """Detect green-screen halo artifacts along sprite edges.

    Finds the boundary between opaque and transparent/green regions,
    then checks if edge pixels retain green colour remnants.

    Args:
        path: Path to the PNG frame.
        green_threshold: Minimum green channel value to consider as halo.
        halo_limit: Maximum fraction of edge pixels with halo before failing.

    Returns:
        Dict with pass/halo_ratio/detail, or None if image is unreadable.
    """
    try:
        with Image.open(path) as img:
            img = img.convert("RGBA")
            w, h = img.size
            pixels = img.load()

            edge_count = 0
            halo_count = 0

            for y in range(h):
                for x in range(w):
                    r, g, b, a = pixels[x, y]
                    # Skip background pixels (transparent or chroma key)
                    if a < 10 or (g > green_threshold and g > r + 30 and g > b + 30) or (b > green_threshold and b > r + 30 and b > g + 30):
                        continue
                    # Skip interior pixels (not near a background neighbour)
                    is_edge = False
                    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h:
                            nr, ng, nb, na = pixels[nx, ny]
                            if na < 10 or (ng > green_threshold and ng > nr + 30 and ng > nb + 30) or (nb > green_threshold and nb > nr + 30 and nb > ng + 30):
                                is_edge = True
                                break
                        else:
                            is_edge = True
                            break
                    if not is_edge:
                        continue

                    edge_count += 1
                    # Check for green/blue remnant in this opaque edge pixel
                    if (g > green_threshold and g > r + 20 and g > b + 20) or (b > green_threshold and b > r + 20 and b > g + 20):
                        halo_count += 1

            if edge_count == 0:
                return {"pass": True, "halo_ratio": 0.0, "detail": "No edges found"}

            ratio = halo_count / edge_count
            ok = ratio <= halo_limit
            return {
                "pass": ok,
                "halo_ratio": round(ratio, 4),
                "detail": "OK" if ok else f"Edge halo: {ratio:.1%} of edge pixels retain chroma key ({halo_count}/{edge_count})",
            }
    except Exception:
        log.exception("Edge halo detection failed for: %s", path)
        return None


def detect_centroid_drift(
    path_a: Path,
    path_b: Path,
    frame_size: int = 512,
    threshold: float = 0.05,
) -> dict | None:
    """Detect centroid position drift between two consecutive frames.

    Computes the centroid of non-transparent pixels in each frame and
    checks if the offset exceeds a threshold fraction of frame_size.

    Args:
        path_a: Previous frame.
        path_b: Current frame.
        frame_size: Pixel dimension of the square frame.
        threshold: Maximum allowed centroid drift as fraction of frame_size.

    Returns:
        Dict with pass/drift_px/drift_ratio/detail, or None on error.
    """
    def _centroid(path: Path) -> tuple[float, float] | None:
        try:
            with Image.open(path) as img:
                img = img.convert("RGBA")
                w, h = img.size
                sx, sy, count = 0.0, 0.0, 0
                for y in range(h):
                    for x in range(w):
                        r, g, b, a = img.getpixel((x, y))
                        if a <= 10 or _is_chroma_key(r, g, b):
                            continue
                        sx += x
                        sy += y
                        count += 1
                if count == 0:
                    return None
                return (sx / count, sy / count)
        except Exception:
            return None

    ca = _centroid(path_a)
    cb = _centroid(path_b)
    if ca is None or cb is None:
        return None

    dx = abs(ca[0] - cb[0])
    dy = abs(ca[1] - cb[1])
    drift_px = (dx**2 + dy**2) ** 0.5
    drift_ratio = drift_px / frame_size
    ok = drift_ratio <= threshold
    return {
        "pass": ok,
        "drift_px": round(drift_px, 1),
        "drift_ratio": round(drift_ratio, 4),
        "detail": "OK" if ok else f"Centroid drift {drift_px:.1f}px ({drift_ratio:.1%} of frame)",
    }
