"""Spritesheet packer: key each frame, lay frames out on a grid, write the atlas.

Produces in the output directory:
  - {asset}.png, plus {asset}.webp when cwebp is on PATH
  - atlas.json (PixiJS spritesheet JSON, validates against atlas.schema.json)

Frames are taken from request.yml in declared order. Tuning the editor already
saved into atlas.json survives a re-pack: per-frame anchor and duration, and
every top-level block the packer does not own (states, inputs, transitions,
initial, poses, animationConfig, ...).
"""

from __future__ import annotations

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


def _grid_layout(n: int) -> tuple[int, int]:
    """Calculate a near-square grid (cols, rows) for n items."""
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    return cols, rows


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


def _auto_anchor(alphas: list[np.ndarray], asset_type: str) -> dict[str, float]:
    """Anchor shared by an animation's frames, from the union of their subject boxes.

    Characters and objects stand on the bottom of the box; effects pivot on its centre.
    """
    union = np.logical_or.reduce([alpha >= OPAQUE_ALPHA for alpha in alphas])
    if not union.any():
        return {"x": 0.5, "y": 0.5}
    size = union.shape[0]
    ys, xs = np.nonzero(union)
    x = (xs.min() + xs.max() + 1) / 2 / size
    y = (ys.min() + ys.max() + 1) / 2 / size if asset_type == "effect" else (ys.max() + 1) / size
    return {"x": round(float(x), 3), "y": round(float(y), 3)}


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

    cols, rows = _grid_layout(len(specs))
    sheet_w, sheet_h = cols * frame_size, rows * frame_size
    if max(sheet_w, sheet_h) > MAX_SHEET_PX:
        log.warning("Sheet is %dx%d px, above the %d px many GPUs support.", sheet_w, sheet_h, MAX_SHEET_PX)
    log.info("Packing %d frames into %dx%d grid (%dx%d px)", len(specs), cols, rows, sheet_w, sheet_h)

    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    animations: dict[str, list[str]] = {}
    alphas: dict[str, list[np.ndarray]] = {}
    frames: dict[str, dict] = {}
    for index, spec in enumerate(specs):
        name = spec["name"]
        with Image.open(frames_dir / f"{name}.png") as source:
            try:
                keyed, _ = chroma.key_image(source)
            except chroma.ChromaKeyError as exc:
                raise ValueError(f"{name}.png: {exc}") from exc
        keyed = _fit(keyed, frame_size)
        x, y = (index % cols) * frame_size, (index // cols) * frame_size
        sheet.paste(keyed, (x, y))
        animations.setdefault(spec["animation"], []).append(name)
        alphas.setdefault(spec["animation"], []).append(np.asarray(keyed)[..., 3])
        frames[name] = {
            "frame": {"x": x, "y": y, "w": frame_size, "h": frame_size},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": frame_size, "h": frame_size},
            "sourceSize": {"w": frame_size, "h": frame_size},
            "anchor": None,
            "duration": round(1000 / (spec["fps"] or DEFAULT_FPS)),
        }

    for animation, names in animations.items():
        anchor = _auto_anchor(alphas[animation], asset_type)
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

    atlas: dict = {
        "meta": {"image": image_path.name, "size": {"w": sheet_w, "h": sheet_h}, "scale": "1"},
        "assetType": asset_type,
        "frames": frames,
        "animations": animations,
    }
    atlas.update({key: value for key, value in previous.items() if key not in PACKER_KEYS})
    _atomic_write(atlas_path, (json.dumps(atlas, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    log.info("Atlas: %s (%d frames, %d animations)", atlas_path, len(frames), len(animations))
    return atlas
