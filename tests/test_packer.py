from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from tools.sprite_pipeline import packer
from tools.sprite_pipeline.schema_validator import validate_atlas
from tools.sprite_pipeline.spec import frame_name

GREEN = (10, 238, 7)


def _write_frame(path: Path, size: int, box: tuple[int, int, int, int], colour=(30, 90, 250)) -> None:
    frame = np.zeros((size, size, 3), dtype=np.uint8)
    frame[...] = GREEN
    frame[box[1]:box[3], box[0]:box[2]] = colour
    Image.fromarray(frame).save(path)


def _asset(root: Path, request: dict, boxes: dict[str, tuple[int, int, int, int]]) -> Path:
    asset = root / "hero"
    (asset / "frames").mkdir(parents=True)
    for name, box in boxes.items():
        _write_frame(asset / "frames" / f"{name}.png", request["frame_size"], box)
    return asset


class SpecTests(unittest.TestCase):
    def test_frame_name_omits_an_empty_direction(self) -> None:
        self.assertEqual(frame_name("walk", "front", 3), "walk_front_03")
        self.assertEqual(frame_name("swim", "", 3), "swim_03")


class PackerTests(unittest.TestCase):
    REQUEST = {
        "frame_size": 32,
        "asset_type": "character",
        "animations": [
            {"action": "idle", "direction": "front", "frames": 2, "fps": 10},
            {"action": "swim", "direction": "", "frames": 1},
        ],
    }
    BOXES = {"idle_front_00": (8, 4, 24, 28), "idle_front_01": (10, 6, 22, 28), "swim_00": (4, 8, 28, 24)}

    def test_packs_declared_frames_in_order_with_keyed_pixels(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = _asset(Path(tmp), self.REQUEST, self.BOXES)
            # A stray file in frames/ is not part of the request and must not be packed.
            _write_frame(asset / "frames" / "unused_00.png", 32, (0, 0, 4, 4))

            atlas = packer.pack(asset, self.REQUEST)

            self.assertEqual(validate_atlas(atlas), [])
            self.assertEqual(atlas["animations"], {"idle_front": ["idle_front_00", "idle_front_01"], "swim": ["swim_00"]})
            self.assertEqual(atlas["frames"]["idle_front_00"]["duration"], 100)
            self.assertEqual(atlas["frames"]["swim_00"]["duration"], round(1000 / packer.DEFAULT_FPS))
            # Characters stand on the bottom of the animation's union box, centred on it.
            self.assertEqual(atlas["frames"]["idle_front_01"]["anchor"], {"x": 0.5, "y": 0.875})

            with Image.open(asset / "output" / "hero.png") as sheet:
                pixels = np.asarray(sheet.convert("RGBA"))
            first = atlas["frames"]["idle_front_00"]["frame"]
            cell = pixels[first["y"]:first["y"] + 32, first["x"]:first["x"] + 32]
            self.assertEqual(cell[0, 0, 3], 0)
            self.assertEqual(tuple(cell[16, 16]), (30, 90, 250, 255))

    def test_repack_keeps_editor_tuning_unless_fresh(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = _asset(Path(tmp), self.REQUEST, self.BOXES)
            atlas = packer.pack(asset, self.REQUEST)
            atlas["frames"]["idle_front_00"]["anchor"] = {"x": 0.25, "y": 0.75}
            atlas["frames"]["idle_front_00"]["duration"] = 250
            atlas["states"] = {"idle": {"animation": "idle_front", "loop": True}}
            atlas["initial"] = "idle"
            (asset / "output" / "atlas.json").write_text(json.dumps(atlas))

            repacked = packer.pack(asset, self.REQUEST)
            self.assertEqual(repacked["frames"]["idle_front_00"]["anchor"], {"x": 0.25, "y": 0.75})
            self.assertEqual(repacked["frames"]["idle_front_00"]["duration"], 250)
            self.assertEqual(repacked["initial"], "idle")
            self.assertIn("states", repacked)

            fresh = packer.pack(asset, self.REQUEST, fresh=True)
            self.assertEqual(fresh["frames"]["idle_front_00"]["duration"], 100)
            self.assertNotIn("states", fresh)

    def test_missing_declared_frame_fails_loudly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            boxes = dict(self.BOXES)
            del boxes["swim_00"]
            asset = _asset(Path(tmp), self.REQUEST, boxes)
            with self.assertRaisesRegex(FileNotFoundError, "swim_00.png"):
                packer.pack(asset, self.REQUEST)

    def test_effects_pivot_on_the_centre(self) -> None:
        request = {"frame_size": 32, "asset_type": "effect", "animations": [{"action": "burn", "direction": "loop", "frames": 1}]}
        with tempfile.TemporaryDirectory() as tmp:
            asset = _asset(Path(tmp), request, {"burn_loop_00": (8, 8, 24, 24)})
            atlas = packer.pack(asset, request)
            self.assertEqual(atlas["frames"]["burn_loop_00"]["anchor"], {"x": 0.5, "y": 0.5})


if __name__ == "__main__":
    unittest.main()
