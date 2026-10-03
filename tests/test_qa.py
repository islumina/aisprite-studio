from __future__ import annotations

import importlib
import tempfile
import unittest
from pathlib import Path

from PIL import Image


qa = importlib.import_module("tools.sprite_pipeline.qa")


def _frame(path: Path, box: tuple[int, int, int, int]) -> None:
    image = Image.new("RGBA", (64, 64), (0, 255, 0, 255))
    for y in range(box[1], box[3]):
        for x in range(box[0], box[2]):
            image.putpixel((x, y), (220, 80, 80, 255))
    image.save(path)


class QaSuiteTests(unittest.TestCase):
    def test_missing_frame_has_repair_hint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = Path(tmp)
            (asset / "frames").mkdir()

            report = qa.run_suite(
                asset,
                ["idle_front_00"],
                expected_size=64,
                skip_vision=True,
            )

            failed = report["frames"]["idle_front_00"]
            self.assertEqual(failed["status"], "fail")
            self.assertIn("missing or invalid PNG", failed["repair_hint"])

    def test_renamed_jpeg_fails_with_its_real_format(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = Path(tmp)
            (asset / "frames").mkdir()
            Image.new("RGB", (64, 64), (0, 255, 0)).save(asset / "frames" / "idle_front_00.png", "JPEG")

            report = qa.run_suite(asset, ["idle_front_00"], expected_size=64, skip_vision=True)

            failed = report["frames"]["idle_front_00"]
            self.assertEqual(failed["checks"]["exists"]["detail"], "File is JPEG data, not PNG")
            self.assertIn("real PNG", failed["repair_hint"])

    def test_unkeyable_background_fails_with_hint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = Path(tmp)
            (asset / "frames").mkdir()
            Image.new("RGB", (64, 64), (240, 240, 240)).save(asset / "frames" / "idle_front_00.png")

            report = qa.run_suite(asset, ["idle_front_00"], expected_size=64, skip_vision=True)

            failed = report["frames"]["idle_front_00"]
            self.assertFalse(failed["checks"]["chroma_key"]["pass"])
            self.assertIn("solid chroma-key colour", failed["repair_hint"])

    def test_visual_qa_never_passes_when_review_is_pending(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = Path(tmp)
            frames = asset / "frames"
            frames.mkdir()
            _frame(frames / "idle_front_00.png", (20, 20, 44, 44))

            report = qa.run_suite(
                asset,
                ["idle_front_00"],
                expected_size=64,
            )

            frame = report["frames"]["idle_front_00"]
            self.assertEqual(report["overall"], "warn")
            self.assertEqual(frame["status"], "warn")
            self.assertEqual(frame["checks"]["vision_qa"]["status"], "pending")

    def test_drift_is_not_compared_across_animation_boundaries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = Path(tmp)
            frames = asset / "frames"
            frames.mkdir()
            _frame(frames / "idle_front_00.png", (4, 20, 20, 44))
            _frame(frames / "walk_front_00.png", (44, 20, 60, 44))

            report = qa.run_suite(
                asset,
                ["idle_front_00", "walk_front_00"],
                expected_size=64,
                skip_vision=True,
            )

            self.assertEqual(report["overall"], "pass")
            self.assertNotIn("inter_frame_drift", report["frames"]["walk_front_00"]["checks"])

    def test_drift_failure_updates_status_and_repair_hint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = Path(tmp)
            frames = asset / "frames"
            frames.mkdir()
            _frame(frames / "open_front_00.png", (4, 20, 20, 44))
            _frame(frames / "open_front_01.png", (44, 20, 60, 44))

            report = qa.run_suite(
                asset,
                ["open_front_00", "open_front_01"],
                expected_size=64,
                skip_vision=True,
                asset_type="object",
            )

            failed = report["frames"]["open_front_01"]
            self.assertEqual(report["overall"], "fail")
            self.assertEqual(failed["status"], "fail")
            self.assertIn("static object body", failed["repair_hint"])


if __name__ == "__main__":
    unittest.main()
