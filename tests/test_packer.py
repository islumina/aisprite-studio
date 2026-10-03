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

            # Phaser's load.aseprite reads the same file: tags index frames in file order.
            self.assertEqual(atlas["meta"]["frameTags"], [
                {"name": "idle_front", "from": 0, "to": 1, "direction": "forward"},
                {"name": "swim", "from": 2, "to": 2, "direction": "forward"},
            ])

    def test_trimmed_rects_rebuild_each_keyed_frame(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = _asset(Path(tmp), self.REQUEST, self.BOXES)
            atlas = packer.pack(asset, self.REQUEST)
            with Image.open(asset / "output" / "hero.png") as sheet:
                pixels = np.asarray(sheet.convert("RGBA"))

            first = atlas["frames"]["idle_front_00"]
            # Box (8, 4, 24, 28) plus the one-pixel transparent margin.
            self.assertEqual(first["spriteSourceSize"], {"x": 7, "y": 3, "w": 18, "h": 26})
            self.assertEqual(first["frame"]["w"], 18)
            self.assertTrue(first["trimmed"])

            for name, (x0, y0, x1, y1) in self.BOXES.items():
                entry = atlas["frames"][name]
                rect, offset = entry["frame"], entry["spriteSourceSize"]
                rebuilt = np.zeros((32, 32, 4), dtype=np.uint8)
                rebuilt[offset["y"]:offset["y"] + rect["h"], offset["x"]:offset["x"] + rect["w"]] = pixels[
                    rect["y"]:rect["y"] + rect["h"], rect["x"]:rect["x"] + rect["w"]
                ]
                expected = np.zeros((32, 32, 4), dtype=np.uint8)
                expected[y0:y1, x0:x1] = (30, 90, 250, 255)
                np.testing.assert_array_equal(rebuilt, expected, name)

    def test_identical_frames_share_a_rect_and_rects_keep_a_gutter(self) -> None:
        request = {"frame_size": 32, "animations": [{"action": "idle", "direction": "front", "frames": 4}]}
        boxes = {
            "idle_front_00": (8, 4, 24, 28),
            "idle_front_01": (8, 4, 24, 28),
            "idle_front_02": (2, 2, 30, 30),
            "idle_front_03": (12, 10, 20, 20),
        }
        with tempfile.TemporaryDirectory() as tmp:
            asset = _asset(Path(tmp), request, boxes)
            frames = packer.pack(asset, request)["frames"]
            self.assertEqual(frames["idle_front_00"]["frame"], frames["idle_front_01"]["frame"])
            rects = {tuple(f["frame"].values()) for f in frames.values()}
            self.assertEqual(len(rects), 3)
            for a in rects:
                for b in rects:
                    if a == b:
                        continue
                    apart_x = a[0] + a[2] + packer.GUTTER_PX <= b[0] or b[0] + b[2] + packer.GUTTER_PX <= a[0]
                    apart_y = a[1] + a[3] + packer.GUTTER_PX <= b[1] or b[1] + b[3] + packer.GUTTER_PX <= a[1]
                    self.assertTrue(apart_x or apart_y, (a, b))

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
