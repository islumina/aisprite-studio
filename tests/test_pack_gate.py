from __future__ import annotations

import importlib
import json
import tempfile
import unittest
from pathlib import Path


cli = importlib.import_module("tools.ag-sprite.cli")


class PackGateTests(unittest.TestCase):
    def test_non_object_report_blocks_pack_cleanly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = Path(tmp)
            (asset / "qa-report.json").write_text("[]")

            with self.assertRaisesRegex(SystemExit, "QA report must be a JSON object"):
                cli._require_pack_approval(asset)

    def test_non_object_visual_qa_blocks_pack_cleanly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = Path(tmp)
            (asset / "qa-report.json").write_text(json.dumps({
                "overall": "pass",
                "visual_qa": "pass",
            }))

            with self.assertRaisesRegex(SystemExit, "visual_qa must be a JSON object"):
                cli._require_pack_approval(asset)

    def test_failed_visual_qa_blocks_pack(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = Path(tmp)
            (asset / "qa-report.json").write_text(json.dumps({
                "overall": "pass",
                "visual_qa": {"status": "fail"},
            }))

            with self.assertRaisesRegex(SystemExit, "visual_qa.status"):
                cli._require_pack_approval(asset)

    def test_explicit_full_approval_allows_pack(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            asset = Path(tmp)
            (asset / "qa-report.json").write_text(json.dumps({
                "overall": "pass",
                "visual_qa": {"status": "pass"},
            }))

            cli._require_pack_approval(asset)


if __name__ == "__main__":
    unittest.main()
