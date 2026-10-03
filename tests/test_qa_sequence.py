"""Sequence checks, score and hints of the QA suite, on synthetic frames."""

from __future__ import annotations

import asyncio
import importlib
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


qa = importlib.import_module("tools.sprite_pipeline.qa")

SIZE = 128
GREEN = (0, 255, 0)
RED = (200, 60, 60)
BLUE = (60, 60, 210)


def _frame(
    path: Path,
    phase: int = 0,
    scale: float = 1.0,
    colour: tuple[int, int, int] = RED,
    body: tuple[int, int] = (30, 56),
    shift: tuple[int, int] = (0, 0),
    fmt: str = "PNG",
) -> None:
    """A body, a head and a swinging arm on a green screen; `phase` moves the arm."""
    image = np.zeros((SIZE, SIZE, 3), dtype=np.uint8)
    image[:] = GREEN

    def fill(top: int, bottom: int, left: int, right: int, rgb: tuple[int, int, int]) -> None:
        image[max(top, 0):max(bottom, 0), max(left, 0):max(right, 0)] = rgb

    cx, cy = SIZE // 2 + shift[0], SIZE // 2 + shift[1]
    width, height, head = int(body[0] * scale), int(body[1] * scale), int(12 * scale)
    top = cy - height // 2
    fill(top, top + height, cx - width // 2, cx + width // 2, colour)
    fill(top - head, top, cx - head // 2, cx + head // 2, (230, 190, 150))
    arm_top = top + int(phase * 7 * scale)
    fill(arm_top, arm_top + int(20 * scale), cx + width // 2, cx + width // 2 + int(8 * scale), (240, 200, 60))
    Image.fromarray(image).save(path, fmt)


def _run(asset: Path, names: list[str], asset_type: str = "character") -> dict:
    return asyncio.run(qa.run_suite(asset, names, expected_size=SIZE, skip_vision=True, asset_type=asset_type))


def _names(count: int, animation: str = "walk_front") -> list[str]:
    return [f"{animation}_{i:02d}" for i in range(count)]


class SequenceCheckTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.asset = Path(self._tmp.name)
        self.frames = self.asset / "frames"
        self.frames.mkdir()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _clean(self, names: list[str]) -> None:
        for i, name in enumerate(names):
            _frame(self.frames / f"{name}.png", phase=i)

    def test_clean_animation_passes_with_full_score(self) -> None:
        names = _names(6)
        self._clean(names)

        report = _run(self.asset, names)

        self.assertEqual(report["overall"], "pass")
        self.assertEqual(report["score"], 100)
        self.assertEqual(report["animations"]["walk_front"], {"score": 100, "issues": [], "hints": []})
        for name in names:
            checks = report["frames"][name]["checks"]
            for check in ("edge_contact", "scale_drift", "colour_drift"):
                self.assertTrue(checks[check]["pass"], (name, check, checks[check]))
            self.assertNotIn("repair_hint", report["frames"][name])
        self.assertNotIn("duplicate_frame", report["frames"][names[0]]["checks"])
        self.assertTrue(report["frames"][names[1]]["checks"]["duplicate_frame"]["pass"])

    def test_duplicate_frame_names_the_frame_it_copies(self) -> None:
        names = _names(6)
        self._clean(names)
        _frame(self.frames / "walk_front_03.png", phase=2)

        report = _run(self.asset, names)

        frame = report["frames"]["walk_front_03"]
        self.assertEqual(report["overall"], "fail")
        self.assertEqual(frame["status"], "fail")
        self.assertEqual(frame["checks"]["duplicate_frame"]["nearest"], "walk_front_02")
        self.assertFalse(frame["checks"]["duplicate_frame"]["pass"])
        self.assertIn("between walk_front_02 and walk_front_04; it duplicates walk_front_02", frame["repair_hint"])
        animation = report["animations"]["walk_front"]
        self.assertEqual(animation["issues"], [{
            "check": "duplicate_frame", "frames": ["walk_front_03"], "detail": "walk_front_03 duplicates walk_front_02",
        }])
        self.assertEqual(animation["score"], 85)

    def test_last_frame_copying_the_first_gets_a_loop_hint(self) -> None:
        names = _names(5)
        self._clean(names)
        _frame(self.frames / "walk_front_04.png", phase=0)

        report = _run(self.asset, names)

        hint = report["frames"]["walk_front_04"]["repair_hint"]
        self.assertIn("Redraw walk_front_04 as the step leading back into walk_front_00", hint)
        self.assertEqual(report["animations"]["walk_front"]["issues"][0]["frames"], ["walk_front_04"])

    def test_static_animation_is_reported_once_as_no_motion(self) -> None:
        names = _names(4, "idle_front")
        for name in names:
            _frame(self.frames / f"{name}.png", phase=1)

        report = _run(self.asset, names)

        animation = report["animations"]["idle_front"]
        self.assertEqual([issue["check"] for issue in animation["issues"]], ["no_motion"])
        self.assertEqual(animation["issues"][0]["frames"], names[1:])
        self.assertEqual(animation["score"], 40)
        self.assertEqual(report["frames"]["idle_front_00"]["status"], "pass")
        for name in names[1:]:
            self.assertEqual(report["frames"][name]["status"], "fail")
            self.assertIn("near-identical to idle_front_00", report["frames"][name]["repair_hint"])

    def test_rescaled_subject_is_scale_drift(self) -> None:
        names = _names(6)
        self._clean(names)
        _frame(self.frames / "walk_front_03.png", phase=3, scale=1.3)

        report = _run(self.asset, names)

        check = report["frames"]["walk_front_03"]["checks"]["scale_drift"]
        self.assertFalse(check["pass"])
        self.assertGreater(check["height_ratio"], 1.2)
        self.assertIn("Redraw walk_front_03 at the scale of", report["frames"]["walk_front_03"]["repair_hint"])
        self.assertEqual(
            [issue["check"] for issue in report["animations"]["walk_front"]["issues"]], ["scale_drift"],
        )

    def test_pose_change_with_the_same_area_is_not_scale_drift(self) -> None:
        names = _names(6, "jump_front")
        self._clean(names)
        # A crouch: a third shorter and wider by as much, so the subject area holds.
        _frame(self.frames / "jump_front_02.png", phase=1, body=(45, 37))

        report = _run(self.asset, names)

        check = report["frames"]["jump_front_02"]["checks"]["scale_drift"]
        self.assertLess(check["height_ratio"], 0.85)
        self.assertTrue(check["pass"], check)

    def test_recoloured_subject_is_colour_drift_with_a_palette_hint(self) -> None:
        names = _names(6)
        self._clean(names)
        _frame(self.frames / "walk_front_02.png", phase=2, colour=BLUE)

        report = _run(self.asset, names)

        frame = report["frames"]["walk_front_02"]
        self.assertFalse(frame["checks"]["colour_drift"]["pass"])
        self.assertLess(frame["checks"]["colour_drift"]["overlap"], qa.COLOUR_MIN_OVERLAP)
        self.assertRegex(frame["repair_hint"], r"Match walk_front_02's palette to walk_front_0\d: mostly red")
        self.assertIn("without the blue areas", frame["repair_hint"])
        for name in names:
            if name != "walk_front_02":
                self.assertTrue(report["frames"][name]["checks"]["colour_drift"]["pass"], name)

    def test_cropped_subject_touches_the_edge(self) -> None:
        _frame(self.frames / "idle_front_00.png", shift=(0, -45))

        report = _run(self.asset, ["idle_front_00"])

        frame = report["frames"]["idle_front_00"]
        self.assertEqual(frame["checks"]["edge_contact"]["sides"], ["top"])
        self.assertEqual(frame["status"], "fail")
        self.assertIn("cropped at the top edge", frame["repair_hint"])
        self.assertEqual(report["animations"]["idle_front"]["score"], 90)

    def test_renamed_jpeg_frames_still_get_sequence_checks(self) -> None:
        names = _names(5, "idle_loop")
        for i, name in enumerate(names):
            _frame(self.frames / f"{name}.png", phase=i, colour=RED if i != 3 else BLUE, fmt="JPEG")

        report = asyncio.run(qa.run_suite(self.asset, names, expected_size=SIZE, skip_vision=True, asset_type="effect"))

        frame = report["frames"]["idle_loop_03"]
        self.assertEqual(frame["checks"]["exists"]["detail"], "File is JPEG data, not PNG")
        self.assertFalse(frame["checks"]["colour_drift"]["pass"])
        self.assertTrue(frame["repair_hint"].startswith("Re-export the frame as a real PNG"))
        self.assertIn("Match idle_loop_03's palette", frame["repair_hint"])
        checks = [issue["check"] for issue in report["animations"]["idle_loop"]["issues"]]
        self.assertEqual(checks, ["exists", "colour_drift"])
        self.assertEqual(report["animations"]["idle_loop"]["score"], 100 - 60 - 10)

    def test_frames_failing_coverage_are_left_out_of_sequence_checks(self) -> None:
        names = _names(4)
        self._clean(names)
        Image.new("RGB", (SIZE, SIZE), GREEN).save(self.frames / "walk_front_03.png")

        report = _run(self.asset, names)

        frame = report["frames"]["walk_front_03"]
        self.assertFalse(frame["checks"]["alpha_coverage"]["pass"])
        self.assertNotIn("duplicate_frame", frame["checks"])
        self.assertIn("covers 5-95%", frame["repair_hint"])


class ScoreTests(unittest.TestCase):
    @staticmethod
    def _reports(names: list[str], failing: dict[str, list[str]]) -> dict[str, dict]:
        reports = {}
        for name in names:
            checks = {"exists": {"pass": True}, "dimensions": {"pass": True}}
            for check in failing.get(name, []):
                checks[check] = {"pass": False, "detail": f"{check} failed"}
            reports[name] = {"status": "fail" if name in failing else "pass", "checks": checks}
        return reports

    def test_penalties_add_up_per_frame_and_cap_per_check(self) -> None:
        names = _names(8)
        reports = self._reports(names, {"walk_front_00": ["alpha_coverage"], "walk_front_01": ["alpha_coverage"]})
        findings = [qa._Finding("colour_drift", (name,), "d", f"hint {name}") for name in names[2:7]]
        findings.append(qa._Finding("duplicate_frame", ("walk_front_07",), "d", "hint dup"))

        result = qa._animation_report(names, reports, findings, "character")

        # alpha_coverage 2 x 10, colour_drift 5 x 10 capped at 30, duplicate_frame 1 x 15.
        self.assertEqual(result["score"], 100 - 20 - 30 - 15)
        self.assertEqual([issue["check"] for issue in result["issues"]], ["alpha_coverage", "duplicate_frame", "colour_drift"])
        self.assertEqual(result["issues"][0]["frames"], ["walk_front_00", "walk_front_01"])
        self.assertTrue(result["hints"][0].startswith("walk_front_00, walk_front_01: Reframe the character"))
        self.assertEqual(len(result["hints"]), 1 + 1 + 5)

    def test_score_never_drops_below_zero(self) -> None:
        names = _names(4)
        reports = self._reports(names, {name: ["exists", "alpha_coverage"] for name in names})
        findings = [qa._Finding("no_motion", tuple(names[1:]), "d", "static")]

        self.assertEqual(qa._animation_report(names, reports, findings, "character")["score"], 0)

    def test_report_score_is_the_lowest_animation_score(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = Path(tmp)
            (asset / "frames").mkdir()
            walk, idle = _names(4), _names(3, "idle_front")
            for i, name in enumerate(walk):
                _frame(asset / "frames" / f"{name}.png", phase=i)
            for name in idle:
                _frame(asset / "frames" / f"{name}.png", phase=1)

            report = _run(asset, walk + idle)

            self.assertEqual(report["animations"]["walk_front"]["score"], 100)
            self.assertEqual(report["animations"]["idle_front"]["score"], 40)
            self.assertEqual(report["score"], 40)


if __name__ == "__main__":
    unittest.main()
