from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from tools.sprite_pipeline.generation_plan import build_generation_plan


class GenerationPlanTests(unittest.TestCase):
    def test_lists_only_missing_frames_with_concrete_reference_path(self) -> None:
        with TemporaryDirectory() as directory:
            asset = Path(directory) / "hero"
            frames = asset / "frames"
            frames.mkdir(parents=True)
            (frames / "idle_front_00.png").write_bytes(b"fixture")
            (asset / "request.yml").write_text(
                "\n".join([
                    "character: hero",
                    "style: flat game sprite",
                    "frame_size: 32",
                    "asset_type: character",
                    "animations:",
                    "  - action: idle",
                    "    direction: front",
                    "    frames: 2",
                ]),
                encoding="utf-8",
            )

            plan = build_generation_plan(asset)

            self.assertIn("assets/hero/tpose.png", plan)
            self.assertIn("[idle_front_01]", plan)
            self.assertNotIn("[idle_front_00]", plan)
            self.assertNotIn("Antigravity", plan)

    def test_reports_missing_request(self) -> None:
        with TemporaryDirectory() as directory:
            asset = Path(directory) / "missing"
            self.assertEqual(
                build_generation_plan(asset),
                f"Error: {asset / 'request.yml'} not found",
            )


if __name__ == "__main__":
    unittest.main()
