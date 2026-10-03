from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from tools.sprite_pipeline import row

RED = (200, 40, 40)


def _row_picture(layout: row.RowLayout, poses: list[tuple[int, int, int]], asset_type: str = "character") -> Image.Image:
    """Draw (width, height, lift) rectangles in each slot of the guide, as a model would."""
    picture = np.asarray(row.draw_guide(layout, asset_type)).copy()
    x0, y0 = layout.origin
    for index, (width, height, lift) in enumerate(poses):
        left = x0 + (index % layout.columns) * layout.slot + (layout.slot - width) // 2
        floor = y0 + (index // layout.columns + 1) * layout.slot - round(layout.slot * row.SAFE_MARGIN)
        picture[floor - lift - height:floor - lift, left:left + width] = RED
    return Image.fromarray(picture)


def _box(frame: Image.Image) -> tuple[int, int, int, int]:
    alpha = np.asarray(frame)[..., 3] >= 128
    ys, xs = np.nonzero(alpha)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


class LayoutTests(unittest.TestCase):
    def test_picks_the_largest_square_slot(self) -> None:
        layout = row.plan_layout(8)
        self.assertEqual((layout.columns, layout.rows, layout.slot), (4, 2, 384))
        self.assertEqual(row.plan_layout(6).slot, 512)

    def test_guide_lines_key_away_if_the_model_copies_them(self) -> None:
        from tools.sprite_pipeline import chroma

        keyed, _ = chroma.key_image(row.draw_guide(row.plan_layout(4), "character"))
        self.assertEqual(int(np.asarray(keyed)[..., 3].max()), 0)


class ExtractTests(unittest.TestCase):
    def test_cuts_poses_in_reading_order_at_one_scale(self) -> None:
        layout = row.plan_layout(6)
        poses = [(100, 300, 0), (120, 300, 0), (140, 300, 0), (100, 300, 0), (100, 240, 0), (100, 300, 0)]
        frames, report = row.extract_poses(_row_picture(layout, poses), layout, 256, "character")

        self.assertEqual(len(frames), 6)
        widths = [_box(frame)[2] - _box(frame)[0] for frame in frames]
        self.assertEqual(widths[:3], sorted(widths[:3]))  # 100, 120, 140 stay in order and ratio
        self.assertAlmostEqual(widths[1] / widths[0], 1.2, delta=0.05)
        heights = [_box(frame)[3] - _box(frame)[1] for frame in frames]
        self.assertAlmostEqual(heights[4] / heights[0], 0.8, delta=0.03)  # one shared scale
        bottoms = {_box(frame)[3] for frame in frames}
        self.assertEqual(len(bottoms), 1)  # all stand on the same baseline
        self.assertEqual(report["layout"]["frames"], 6)

    def test_keeps_a_jump_above_the_floor(self) -> None:
        layout = row.plan_layout(3)
        frames, _ = row.extract_poses(_row_picture(layout, [(80, 200, 0), (80, 200, 120), (80, 200, 0)]), layout, 256, "character")
        ground, apex = _box(frames[0])[3], _box(frames[1])[3]
        self.assertGreater(ground - apex, 30)

    def test_centres_effects(self) -> None:
        layout = row.plan_layout(2)
        frames, _ = row.extract_poses(_row_picture(layout, [(200, 200, 100), (150, 150, 20)], "effect"), layout, 256, "effect")
        for frame in frames:
            x0, y0, x1, y1 = _box(frame)
            self.assertAlmostEqual((x0 + x1) / 2, 128, delta=2)
            self.assertAlmostEqual((y0 + y1) / 2, 128, delta=2)

    def test_refuses_a_row_with_the_wrong_number_of_poses(self) -> None:
        layout = row.plan_layout(4)
        picture = _row_picture(row.plan_layout(4), [(100, 300, 0)] * 3)
        with self.assertRaisesRegex(row.RowError, "grid row 2: found 1 pose"):
            row.extract_poses(picture, layout, 256, "character")

    def test_refuses_touching_poses(self) -> None:
        layout = row.plan_layout(2)
        picture = np.asarray(_row_picture(layout, [(500, 300, 0), (500, 300, 0)])).copy()
        x0, y0 = layout.origin
        middle = y0 + layout.slot - round(layout.slot * row.SAFE_MARGIN) - 150
        picture[middle:middle + 20, x0 + 200:x0 + 2 * layout.slot - 200] = RED  # a bridge between the poses
        with self.assertRaisesRegex(row.RowError, "found 1 pose"):
            row.extract_poses(Image.fromarray(picture), layout, 256, "character")

    def test_ignores_specks_between_poses(self) -> None:
        layout = row.plan_layout(2)
        picture = np.asarray(_row_picture(layout, [(200, 300, 0), (200, 300, 0)])).copy()
        x0, y0 = layout.origin
        picture[y0 + 50:y0 + 53, x0 + layout.slot - 1:x0 + layout.slot + 2] = RED
        frames, _ = row.extract_poses(Image.fromarray(picture), layout, 256, "character")
        self.assertEqual(len(frames), 2)


class ExtractRowFileTests(unittest.TestCase):
    REQUEST = {"frame_size": 128, "asset_type": "character", "animations": [{"action": "idle", "direction": "front", "frames": 4}]}

    def test_writes_all_frames_or_none(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = Path(tmp)
            (asset / "raw").mkdir()
            layout = row.plan_layout(4)
            _row_picture(layout, [(100, 300, 0)] * 3).save(asset / "raw" / "idle_front.png")
            with self.assertRaises(row.RowError):
                row.extract_row(asset, self.REQUEST, "idle_front", asset / "raw" / "idle_front.png")
            self.assertEqual(list((asset / "frames").glob("*")) if (asset / "frames").exists() else [], [])

            _row_picture(layout, [(100, 300, 0)] * 4).save(asset / "raw" / "idle_front.png")
            report = row.extract_row(asset, self.REQUEST, "idle_front", asset / "raw" / "idle_front.png")
            self.assertEqual(sorted(p.name for p in (asset / "frames").iterdir()), report["frames"])
            self.assertEqual(json.loads((asset / "raw" / "idle_front.json").read_text())["frames"], report["frames"])
            with Image.open(asset / "frames" / "idle_front_00.png") as frame:
                self.assertEqual((frame.mode, frame.size), ("RGBA", (128, 128)))

            with self.assertRaisesRegex(row.RowError, "already exist"):
                row.extract_row(asset, self.REQUEST, "idle_front", asset / "raw" / "idle_front.png")
            row.extract_row(asset, self.REQUEST, "idle_front", asset / "raw" / "idle_front.png", replace=True)

    def test_unknown_animation(self) -> None:
        with self.assertRaisesRegex(row.RowError, "not declared"):
            row.write_guide(Path("."), self.REQUEST, "walk_front")


if __name__ == "__main__":
    unittest.main()
