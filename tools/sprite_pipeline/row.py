"""Row generation: one picture holds a whole animation, cut into frames by content.

A row task asks an image agent for every pose of an animation in one picture,
laid out on the grid of an attached guide. Poses drawn side by side keep their
identity, scale and palette far more consistent than frames generated one at a
time. Extraction keys the picture and finds the poses where the subject actually
is (gaps in its alpha), not where the guide's boxes are, and refuses the row
unless it finds exactly the declared number of poses.
"""

from __future__ import annotations

import json
import math
import os
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from . import chroma
from .spec import frame_specs

GUIDE_CANVAS = (1536, 1024)
GUIDE_BACKGROUND = (0, 255, 0)
# Within chroma.KEY_DISTANCE of the background: a guide line the model copies is keyed away.
GUIDE_LINE = (0, 196, 48)
# Share of a slot (and of a frame) kept empty on every side.
SAFE_MARGIN = 0.08
# Alpha above this counts as subject when looking for gaps between poses.
SEGMENT_ALPHA = 16
# A run whose alpha mass is below this share of the largest run is a speck, not a pose.
MIN_POSE_SHARE = 0.03
# Runs closer than this share of a slot belong to the same pose.
MIN_GAP_SHARE = 0.04


class RowError(ValueError):
    """The submitted row cannot be turned into the declared frames."""


@dataclass(frozen=True)
class RowLayout:
    frames: int
    columns: int
    rows: int
    slot: int  # side of each square slot, in guide pixels
    canvas: tuple[int, int]

    @property
    def origin(self) -> tuple[int, int]:
        """Top-left of the slot grid, which is centred on the canvas."""
        return (self.canvas[0] - self.columns * self.slot) // 2, (self.canvas[1] - self.rows * self.slot) // 2

    def per_row(self, row: int) -> int:
        """Number of poses expected in grid row `row`."""
        return min(self.columns, self.frames - row * self.columns)


def plan_layout(frames: int, canvas: tuple[int, int] = GUIDE_CANVAS) -> RowLayout:
    """Grid of square slots that fits `frames` poses on the canvas with the largest slot."""
    if frames < 1:
        raise RowError("an animation needs at least one frame")
    best = None
    for columns in range(1, frames + 1):
        rows = math.ceil(frames / columns)
        slot = min(canvas[0] // columns, canvas[1] // rows)
        if best is None or slot > best.slot:
            best = RowLayout(frames, columns, rows, slot, canvas)
    return best


def upscale_factor(layout: RowLayout, frame_size: int) -> float:
    """How much a pose drawn inside its safe area is enlarged to fill a frame."""
    return frame_size / (layout.slot * (1 - 2 * SAFE_MARGIN))


def draw_guide(layout: RowLayout, asset_type: str) -> Image.Image:
    """Slot boxes, safe areas, numbers and (except for effects) a floor line per slot."""
    image = Image.new("RGB", layout.canvas, GUIDE_BACKGROUND)
    draw = ImageDraw.Draw(image)
    font = _font(max(12, layout.slot // 10))
    x0, y0 = layout.origin
    margin = round(layout.slot * SAFE_MARGIN)
    for index in range(layout.frames):
        left = x0 + (index % layout.columns) * layout.slot
        top = y0 + (index // layout.columns) * layout.slot
        right, bottom = left + layout.slot - 1, top + layout.slot - 1
        draw.rectangle((left, top, right, bottom), outline=GUIDE_LINE, width=3)
        draw.rectangle((left + margin, top + margin, right - margin, bottom - margin), outline=GUIDE_LINE, width=1)
        if asset_type != "effect":
            draw.line((left + margin, bottom - margin, right - margin, bottom - margin), fill=GUIDE_LINE, width=3)
        draw.text((left + 6, top + 4), str(index + 1), fill=GUIDE_LINE, font=font)
    return image


def extract_poses(image: Image.Image, layout: RowLayout, frame_size: int, asset_type: str) -> tuple[list[Image.Image], dict]:
    """Key a row picture, find its poses and fit each into a frame_size frame.

    All poses share one scale, so the subject keeps its size from frame to frame.
    Characters and objects keep their height above the floor of their grid row
    (a jump stays a jump); effects are centred.
    """
    try:
        keyed, key = chroma.key_image(image)
    except chroma.ChromaKeyError as exc:
        raise RowError(f"cannot key the row: {exc}") from exc
    rgba = np.asarray(keyed)
    mask = rgba[..., 3] > SEGMENT_ALPHA
    if not mask.any():
        raise RowError("the row is empty after keying")

    min_gap = max(2, round(layout.slot * MIN_GAP_SHARE))
    bands = _runs(mask.sum(axis=1), min_gap)
    if len(bands) != layout.rows:
        raise RowError(f"found {len(bands)} row(s) of poses, expected {layout.rows}")

    boxes: list[tuple[int, int, int, int]] = []  # x0, y0, x1, y1 per pose in reading order
    floors: list[int] = []
    for row, (top, bottom) in enumerate(bands):
        columns = _runs(mask[top:bottom].sum(axis=0), min_gap)
        if len(columns) != layout.per_row(row):
            raise RowError(f"grid row {row + 1}: found {len(columns)} pose(s), expected {layout.per_row(row)}")
        row_boxes = []
        for left, right in columns:
            ys = np.nonzero(mask[top:bottom, left:right].any(axis=1))[0]
            row_boxes.append((left, top + int(ys[0]), right, top + int(ys[-1]) + 1))
        floor = max(box[3] for box in row_boxes)
        boxes.extend(row_boxes)
        floors.extend([floor] * len(row_boxes))

    usable = frame_size * (1 - 2 * SAFE_MARGIN)
    if asset_type == "effect":
        scale = min(usable / max(x1 - x0, y1 - y0) for x0, y0, x1, y1 in boxes)
    else:
        scale = min(min(usable / (x1 - x0), usable / (floor - y0)) for (x0, y0, x1, _), floor in zip(boxes, floors))

    frames = []
    baseline = frame_size * (1 - SAFE_MARGIN)
    for (x0, y0, x1, y1), floor in zip(boxes, floors):
        pose = keyed.crop((x0, y0, x1, y1))
        size = (max(1, round((x1 - x0) * scale)), max(1, round((y1 - y0) * scale)))
        pose = pose.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")
        left = round((frame_size - size[0]) / 2)
        if asset_type == "effect":
            top = round((frame_size - size[1]) / 2)
        else:
            top = round(baseline - (floor - y0) * scale)
        frame = Image.new("RGBA", (frame_size, frame_size), (0, 0, 0, 0))
        frame.alpha_composite(pose, (left, max(0, top)))
        frames.append(frame)

    report = {
        "layout": asdict(layout),
        "key": None if key is None else "#%02x%02x%02x" % tuple(int(round(float(c))) for c in key),
        "scale": round(scale, 4),
        "poses": [list(box) for box in boxes],
    }
    return frames, report


def write_guide(asset_dir: Path, request: dict, animation: str) -> dict:
    """Write raw/<animation>.guide.png and return the row task's layout facts."""
    count = len(_animation_specs(request, animation))
    layout = plan_layout(count)
    path = asset_dir / "raw" / f"{animation}.guide.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_save(draw_guide(layout, request.get("asset_type", "character")), path)
    frame_size = int(request.get("frame_size", 512))
    return {
        "guide": str(path),
        "layout": asdict(layout),
        "pose_px": round(layout.slot * (1 - 2 * SAFE_MARGIN)),
        "upscale": round(upscale_factor(layout, frame_size), 2),
    }


def extract_row(asset_dir: Path, request: dict, animation: str, raw_path: Path, replace: bool = False) -> dict:
    """Cut raw_path into the animation's declared frames under frames/; all or nothing."""
    specs = _animation_specs(request, animation)
    frames_dir = asset_dir / "frames"
    targets = [frames_dir / f"{spec['name']}.png" for spec in specs]
    existing = [target.name for target in targets if target.exists()]
    if existing and not replace:
        raise RowError(f"{len(existing)} frame(s) of '{animation}' already exist, first: {existing[0]}; pass replace to overwrite")

    with Image.open(raw_path) as raw:
        raw.load()
        frames, report = extract_poses(
            raw, plan_layout(len(specs)), int(request.get("frame_size", 512)), request.get("asset_type", "character")
        )

    frames_dir.mkdir(parents=True, exist_ok=True)
    staged: list[tuple[Path, Path]] = []
    try:
        for frame, target in zip(frames, targets):
            fd, temporary = tempfile.mkstemp(dir=frames_dir, prefix=f".{target.stem}.", suffix=".png")
            os.close(fd)
            frame.save(temporary, "PNG")
            staged.append((Path(temporary), target))
        for temporary, target in staged:
            os.replace(temporary, target)
    finally:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)

    report["animation"] = animation
    report["raw"] = str(raw_path)
    report["frames"] = [target.name for target in targets]
    (asset_dir / "raw" / f"{animation}.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def _animation_specs(request: dict, animation: str) -> list[dict]:
    specs = [spec for spec in frame_specs(request) if spec["animation"] == animation]
    if not specs:
        raise RowError(f"animation '{animation}' is not declared in request.yml")
    return specs


def _runs(profile: np.ndarray, min_gap: int) -> list[tuple[int, int]]:
    """Index ranges where `profile` is non-zero, joining gaps shorter than min_gap and dropping specks."""
    filled = np.flatnonzero(profile > 0)
    if len(filled) == 0:
        return []
    breaks = np.flatnonzero(np.diff(filled) > min_gap)
    starts = np.concatenate([[filled[0]], filled[breaks + 1]])
    ends = np.concatenate([filled[breaks], [filled[-1]]]) + 1
    masses = [float(profile[start:end].sum()) for start, end in zip(starts, ends)]
    largest = max(masses)
    return [
        (int(start), int(end))
        for start, end, mass in zip(starts, ends, masses)
        if mass >= largest * MIN_POSE_SHARE
    ]


def _atomic_save(image: Image.Image, path: Path) -> None:
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.stem}.", suffix=".png")
    os.close(fd)
    try:
        image.save(temporary, "PNG")
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def _font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1 has no sized default font
        return ImageFont.load_default()
