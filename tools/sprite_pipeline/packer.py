"""Spritesheet packer: key each frame, trim it, pack the rects, write the atlas.

Produces in the output directory:
  - {asset}.png, plus {asset}.webp when cwebp is on PATH
  - atlas.json: PixiJS spritesheet JSON (validates against atlas.schema.json) whose
    meta also carries Aseprite `frameTags`, so Phaser's `load.aseprite` reads it too

Each keyed frame is trimmed to its visible pixels plus a transparent margin and
packed on shelves with a gutter, so texture filtering never samples a neighbour.
Frames whose trimmed pixels and offset are identical share one rect.

Frames are taken from request.yml in declared order. Tuning the editor already
saved into atlas.json survives a re-pack: per-frame anchor and duration, and
every top-level block the packer does not own (states, inputs, transitions,
initial, poses, animationConfig, ...).
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from . import chroma
from .image_ops import OPAQUE_ALPHA
from .spec import frame_specs

log = logging.getLogger(__name__)

DEFAULT_FPS = 8
# Atlas keys the packer rebuilds every time; anything else is the editor's.
PACKER_KEYS = frozenset({"meta", "assetType", "frames", "animations"})
# Many mobile GPUs cap textures at 4096 px per side.
MAX_SHEET_PX = 4096
# Transparent pixels kept around each trimmed frame, inside its rect.
TRIM_MARGIN_PX = 1
# Empty pixels between packed rects.
GUTTER_PX = 2


def _trim(image: Image.Image) -> tuple[Image.Image, tuple[int, int]]:
    """Crop a keyed frame to its visible pixels plus a margin; return the crop and its offset."""
    alpha = np.asarray(image)[..., 3]
    ys, xs = np.nonzero(alpha)
    if len(xs) == 0:
        return Image.new("RGBA", (1, 1)), (0, 0)
    x0 = max(int(xs.min()) - TRIM_MARGIN_PX, 0)
    y0 = max(int(ys.min()) - TRIM_MARGIN_PX, 0)
    x1 = min(int(xs.max()) + 1 + TRIM_MARGIN_PX, image.width)
    y1 = min(int(ys.max()) + 1 + TRIM_MARGIN_PX, image.height)
    return image.crop((x0, y0, x1, y1)), (x0, y0)


def _shelf_pack(sizes: list[tuple[int, int]], width: int) -> tuple[list[tuple[int, int]], int, int]:
    """Place rects tallest-first on shelves no wider than `width`; return positions and sheet size."""
    positions: list[tuple[int, int]] = [(0, 0)] * len(sizes)
    x = y = shelf_height = used_width = 0
    for index in sorted(range(len(sizes)), key=lambda i: (-sizes[i][1], -sizes[i][0])):
        w, h = sizes[index]
        if x and x + w > width:
            x, y, shelf_height = 0, y + shelf_height + GUTTER_PX, 0
        positions[index] = (x, y)
        used_width = max(used_width, x + w)
        x += w + GUTTER_PX
        shelf_height = max(shelf_height, h)
    return positions, used_width, y + shelf_height


def _pack_rects(sizes: list[tuple[int, int]]) -> tuple[list[tuple[int, int]], int, int]:
    """Try a few shelf widths around the square root of the area; keep the smallest sheet."""
    area = sum((w + GUTTER_PX) * (h + GUTTER_PX) for w, h in sizes)
    widest = max(w for w, _ in sizes)
    best = None
    for factor in (1.0, 1.15, 1.3, 1.5, 2.0):
        layout = _shelf_pack(sizes, max(widest, math.ceil(math.sqrt(area) * factor)))
        rank = (layout[1] * layout[2], max(layout[1], layout[2]))
        if best is None or rank < best[0]:
            best = (rank, layout)
    return best[1]


def _load_previous(atlas_path: Path) -> dict:
    try:
        previous = json.loads(atlas_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot merge into {atlas_path}: {exc}") from exc
    return previous if isinstance(previous, dict) else {}


def _fit(image: Image.Image, size: int) -> Image.Image:
    """Resize a keyed frame to size x size, resampling with premultiplied alpha."""
    if image.size == (size, size):
        return image
    log.warning("Resizing frame from %s to %dx%d", image.size, size, size)
    return image.convert("RGBa").resize((size, size), Image.LANCZOS).convert("RGBA")


def _subject_box(image: Image.Image) -> tuple[int, int, int, int] | None:
    """Bounding box (x0, y0, x1, y1) of a keyed frame's opaque subject, or None."""
    ys, xs = np.nonzero(np.asarray(image)[..., 3] >= OPAQUE_ALPHA)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _auto_anchor(boxes: list[tuple[int, int, int, int] | None], size: int, asset_type: str) -> dict[str, float]:
    """Anchor shared by an animation's frames, from the union of their subject boxes.

    Characters and objects stand on the bottom of the box; effects pivot on its centre.
    """
    found = [box for box in boxes if box is not None]
    if not found:
        return {"x": 0.5, "y": 0.5}
    x0, y0 = min(b[0] for b in found), min(b[1] for b in found)
    x1, y1 = max(b[2] for b in found), max(b[3] for b in found)
    x = (x0 + x1) / 2 / size
    y = (y0 + y1) / 2 / size if asset_type == "effect" else y1 / size
    return {"x": round(x, 3), "y": round(y, 3)}


def _atomic_write(path: Path, data: bytes) -> None:
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def _compress_webp(png_path: Path) -> Path | None:
    cwebp = shutil.which("cwebp")
    if not cwebp:
        log.warning("cwebp not found on PATH; WebP output skipped.")
        return None
    webp_path = png_path.with_suffix(".webp")
    try:
        subprocess.run(
            [cwebp, "-q", "90", str(png_path), "-o", str(webp_path)],
            check=True,
            capture_output=True,
            timeout=60.0,
        )
    except subprocess.TimeoutExpired:
        log.warning("cwebp timed out; WebP output skipped.")
        return None
    except subprocess.CalledProcessError as exc:
        log.warning("cwebp failed: %s", exc.stderr.decode(errors="replace").strip())
        return None
    return webp_path


def pack(asset_dir: Path, request: dict, fresh: bool = False) -> dict:
    """Pack an asset's declared frames into a spritesheet and atlas.json.

    Args:
        asset_dir: Asset directory holding frames/ and request.yml.
        request: Parsed request.yml.
        fresh: Ignore tuning saved in an existing atlas.json.

    Returns:
        The atlas dict (also written to asset_dir/output/atlas.json).
    """
    specs = frame_specs(request)
    if not specs:
        raise ValueError("request.yml declares no animation frames")
    frame_size = int(request.get("frame_size", 512))
    asset_type = request.get("asset_type", "character")
    asset_name = asset_dir.name
    frames_dir = asset_dir / "frames"
    out_dir = asset_dir / "output"

    missing = [s["name"] for s in specs if not (frames_dir / f"{s['name']}.png").is_file()]
    if missing:
        raise FileNotFoundError(f"{len(missing)} declared frame(s) missing, first: {missing[0]}.png")

    out_dir.mkdir(parents=True, exist_ok=True)
    atlas_path = out_dir / "atlas.json"
    previous = {} if fresh else _load_previous(atlas_path)
    previous_frames = previous.get("frames") if isinstance(previous.get("frames"), dict) else {}

    animations: dict[str, list[str]] = {}
    boxes: dict[str, list[tuple[int, int, int, int] | None]] = {}
    rects: dict[str, int] = {}  # frame name -> index into `crops`
    crops: list[tuple[Image.Image, tuple[int, int]]] = []
    seen: dict[bytes, int] = {}
    durations: dict[str, int] = {}
    for spec in specs:
        name = spec["name"]
        with Image.open(frames_dir / f"{name}.png") as source:
            try:
                keyed, _ = chroma.key_image(source)
            except chroma.ChromaKeyError as exc:
                raise ValueError(f"{name}.png: {exc}") from exc
        keyed = _fit(keyed, frame_size)
        animations.setdefault(spec["animation"], []).append(name)
        boxes.setdefault(spec["animation"], []).append(_subject_box(keyed))

        crop, offset = _trim(keyed)
        digest = hashlib.sha256(repr((offset, crop.size)).encode() + crop.tobytes()).digest()
        if digest not in seen:
            seen[digest] = len(crops)
            crops.append((crop, offset))
        rects[name] = seen[digest]
        durations[name] = round(1000 / (spec["fps"] or DEFAULT_FPS))

    positions, sheet_w, sheet_h = _pack_rects([crop.size for crop, _ in crops])
    if max(sheet_w, sheet_h) > MAX_SHEET_PX:
        log.warning("Sheet is %dx%d px, above the %d px many GPUs support.", sheet_w, sheet_h, MAX_SHEET_PX)
    log.info("Packing %d frames as %d rects into %dx%d px", len(specs), len(crops), sheet_w, sheet_h)
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    for (crop, _), position in zip(crops, positions):
        sheet.paste(crop, position)

    frames: dict[str, dict] = {}
    for name, duration in durations.items():
        crop, (ox, oy) = crops[rects[name]]
        x, y = positions[rects[name]]
        w, h = crop.size
        frames[name] = {
            "frame": {"x": x, "y": y, "w": w, "h": h},
            "rotated": False,
            "trimmed": (w, h) != (frame_size, frame_size),
            "spriteSourceSize": {"x": ox, "y": oy, "w": w, "h": h},
            "sourceSize": {"w": frame_size, "h": frame_size},
            "anchor": None,
            "duration": duration,
        }

    for animation, names in animations.items():
        anchor = _auto_anchor(boxes[animation], frame_size, asset_type)
        for name in names:
            frames[name]["anchor"] = anchor
            tuned = previous_frames.get(name)
            if isinstance(tuned, dict):
                for key in ("anchor", "duration"):
                    if key in tuned:
                        frames[name][key] = tuned[key]

    png_path = out_dir / f"{asset_name}.png"
    with tempfile.SpooledTemporaryFile() as buffer:
        sheet.save(buffer, "PNG", optimize=True)
        buffer.seek(0)
        _atomic_write(png_path, buffer.read())
    image_path = _compress_webp(png_path) or png_path

    order = list(frames)
    frame_tags = [
        {"name": animation, "from": order.index(names[0]), "to": order.index(names[-1]), "direction": "forward"}
        for animation, names in animations.items()
    ]
    atlas: dict = {
        "meta": {
            "image": image_path.name,
            "format": "RGBA8888",
            "size": {"w": sheet_w, "h": sheet_h},
            "scale": "1",
            "frameTags": frame_tags,
        },
        "assetType": asset_type,
        "frames": frames,
        "animations": animations,
    }
    atlas.update({key: value for key, value in previous.items() if key not in PACKER_KEYS})
    _atomic_write(atlas_path, (json.dumps(atlas, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    log.info("Atlas: %s (%d frames, %d animations)", atlas_path, len(frames), len(animations))
    return atlas
