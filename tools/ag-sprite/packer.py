"""Spritesheet packer: combine individual frame PNGs into a single atlas.

Produces:
  - spritesheet.png (composited image)
  - atlas.json (PixiJS-compatible, validates against atlas.schema.json)
"""

from __future__ import annotations

import json
import logging
import math
import shutil
import subprocess
from pathlib import Path

from PIL import Image

log = logging.getLogger(__name__)


def _grid_layout(n: int) -> tuple[int, int]:
    """Calculate a near-square grid (cols, rows) for n items."""
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    return cols, rows


def chroma_key(img: Image.Image) -> Image.Image:
    """Convert green screen pixels to transparent."""
    img = img.convert("RGBA")
    datas = img.getdata()
    
    new_data = []
    for r, g, b, a in datas:
        # Filter out dominant green colors
        if g > 100 and g > r + 30 and g > b + 30:
            new_data.append((0, 0, 0, 0))
        # Filter out dominant blue colors
        elif b > 100 and b > r + 30 and b > g + 30:
            new_data.append((0, 0, 0, 0))
        else:
            new_data.append((r, g, b, a))
            
    img.putdata(new_data)
    return img


def pack(
    frames_dir: Path,
    out_dir: Path,
    frame_size: int = 512,
    asset_name: str = "sprite",
    animations: dict[str, list[str]] | None = None,
    asset_type: str = "character",
) -> dict:
    """Pack frame PNGs into a spritesheet + atlas JSON.

    Args:
        frames_dir: Directory containing {name}.png frame files.
        out_dir: Output directory for spritesheet.png and atlas.json.
        frame_size: Expected pixel size of each frame (square).
        asset_name: Name used in the atlas metadata.
        animations: Optional mapping of animation name → ordered frame names.
                    If None, inferred from filenames.

    Returns:
        The atlas dict (also written to disk).
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    # Collect and sort frames
    frame_files = sorted(frames_dir.glob("*.png"))
    if not frame_files:
        raise FileNotFoundError(f"No PNG frames found in {frames_dir}")

    frame_names = [f.stem for f in frame_files]
    n = len(frame_files)
    cols, rows = _grid_layout(n)

    sheet_w = cols * frame_size
    sheet_h = rows * frame_size

    log.info("Packing %d frames into %dx%d grid (%dx%d px)", n, cols, rows, sheet_w, sheet_h)

    # Composite spritesheet
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    frames_data: dict[str, dict] = {}

    for idx, (frame_file, name) in enumerate(zip(frame_files, frame_names)):
        col = idx % cols
        row = idx // cols
        x = col * frame_size
        y = row * frame_size

        try:
            with Image.open(frame_file) as im:
                img = im.convert("RGBA")
            # Resize if needed (should already be correct)
            if img.size != (frame_size, frame_size):
                log.warning("Resizing %s from %s to %dx%d", name, img.size, frame_size, frame_size)
                img = img.resize((frame_size, frame_size), Image.LANCZOS)
            
            # Apply chroma key to remove green screen background
            img = chroma_key(img)
            sheet.paste(img, (x, y))
        except Exception:
            log.exception("Failed to process frame: %s", frame_file)
            continue

        frames_data[name] = {
            "frame": {"x": x, "y": y, "w": frame_size, "h": frame_size},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": frame_size, "h": frame_size},
            "sourceSize": {"w": frame_size, "h": frame_size},
            "anchor": {"x": 0.5, "y": 0.5},
            "duration": 160 if "idle" in name else 133,
        }

    # Infer animations from frame names if not provided
    if animations is None:
        animations = _infer_animations(frame_names)

    # Write outputs
    sheet_filename = f"{asset_name}.png"
    sheet_path = out_dir / sheet_filename
    atlas_path = out_dir / "atlas.json"

    sheet.save(sheet_path, "PNG")
    log.info("Spritesheet PNG saved: %s (%dx%d)", sheet_path, sheet_w, sheet_h)

    # 1. Compress spritesheet to WebP if cwebp is available
    
    cwebp_bin = shutil.which("cwebp")
    if cwebp_bin:
        webp_path = sheet_path.with_suffix(".webp")
        try:
            log.info("Compressing PNG to WebP using cwebp...")
            # Use quality 90 to match high visual quality while heavily shrinking file size
            subprocess.run(
                [cwebp_bin, "-q", "90", str(sheet_path), "-o", str(webp_path)],
                check=True,
                capture_output=True,
                timeout=30.0
            )
            log.info("Compressed webp saved: %s", webp_path)
            # Update the image filename reference in atlas to webp
            sheet_filename = webp_path.name
        except subprocess.TimeoutExpired:
            log.warning("cwebp compression timed out")
        except subprocess.CalledProcessError as e:
            log.warning("cwebp compression failed: %s", e.stderr.decode().strip())
    else:
        log.warning("cwebp command not found on PATH. Spritesheet WebP compression skipped.")

    # Build atlas with potentially updated image reference
    atlas: dict = {
        "meta": {
            "image": sheet_filename,
            "size": {"w": sheet_w, "h": sheet_h},
            "scale": "1",
        },
        "assetType": asset_type,
        "frames": frames_data,
        "animations": animations,
    }

    with open(atlas_path, "w") as f:
        json.dump(atlas, f, indent=2, ensure_ascii=False)

    log.info("Atlas: %s (%d frames, %d animations)", atlas_path, len(frames_data), len(animations))

    return atlas


def _infer_animations(frame_names: list[str]) -> dict[str, list[str]]:
    """Group frame names into animations by prefix.

    "walk_front_00", "walk_front_01" → {"walk_front": ["walk_front_00", "walk_front_01"]}
    """
    groups: dict[str, list[str]] = {}
    for name in frame_names:
        # Strip trailing _XX index
        parts = name.rsplit("_", 1)
        if len(parts) == 2 and parts[1].isdigit():
            prefix = parts[0]
        else:
            prefix = name
        groups.setdefault(prefix, []).append(name)
    return groups
