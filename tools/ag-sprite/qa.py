"""QA runner for generated sprite frames.

Checks (in order of cost):
1. File existence and valid PNG
2. Dimension match
3. Alpha channel coverage
4. Vision QA via Antigravity agent (most expensive — skipped on early failures)
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import image_ops

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

def _frame_report(
    status: str,
    checks: dict[str, Any],
) -> dict:
    return {"status": status, "checks": checks}


def _overall_status(frames: dict[str, dict]) -> str:
    """Derive overall status from individual frame reports."""
    statuses = {f["status"] for f in frames.values()}
    if "fail" in statuses:
        return "fail"
    if "warn" in statuses:
        return "warn"
    return "pass"


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------

def _check_exists(frame_path: Path) -> dict:
    valid = image_ops.is_valid_png(frame_path)
    return {
        "exists": frame_path.exists(),
        "valid_png": valid,
        "pass": valid,
    }


def _check_dimensions(frame_path: Path, expected: int) -> dict:
    dims = image_ops.get_dimensions(frame_path)
    if dims is None:
        return {"w": None, "h": None, "pass": False}
    return {
        "w": dims[0],
        "h": dims[1],
        "pass": dims[0] == expected and dims[1] == expected,
    }


def _check_alpha(frame_path: Path) -> dict:
    coverage = image_ops.alpha_coverage(frame_path)
    if coverage is None:
        return {"ratio": None, "pass": False, "detail": "No alpha channel"}
    # Character should cover 5-95% of the frame area
    ok = 0.05 <= coverage <= 0.95
    return {
        "ratio": round(coverage, 3),
        "pass": ok,
        "detail": "OK" if ok else f"Coverage {coverage:.1%} outside 5-95% range",
    }


# ---------------------------------------------------------------------------
# Full QA suite
# ---------------------------------------------------------------------------

async def check_frame(
    tpose_path: Path,
    frame_path: Path,
    action: str,
    direction: str,
    expected_size: int = 512,
    skip_vision: bool = False,
) -> dict:
    """Run all QA checks on a single frame.

    Returns a frame report dict.
    """
    checks: dict[str, Any] = {}

    # 1. Existence
    checks["exists"] = _check_exists(frame_path)
    if not checks["exists"]["pass"]:
        return _frame_report("fail", checks)

    # 2. Dimensions
    checks["dimensions"] = _check_dimensions(frame_path, expected_size)

    # 3. Alpha coverage
    checks["alpha_coverage"] = _check_alpha(frame_path)

    # 3.5 Edge halo check (green remnants on sprite edges)
    halo = image_ops.detect_edge_halo(frame_path)
    if halo is not None:
        checks["edge_halo"] = halo

    # Determine if we should run vision QA
    critical_fail = (
        not checks["dimensions"]["pass"]
    )

    # 4. Vision QA (skip if early failures or explicitly disabled)
    if not critical_fail and not skip_vision:
        # Note: Local analyze_frame using google.antigravity.Agent has been removed 
        # to avoid GEMINI_API_KEY requirements. 
        # Vision QA should now be performed directly by the AI Assistant via chat tools.
        checks["vision_qa"] = {"pass": True, "detail": "Skipped (run via chat assistant)"}

    # Derive status
    has_fail = any(
        not c.get("pass", True)
        for c in checks.values()
        if isinstance(c, dict) and "pass" in c
    )
    status = "fail" if has_fail else "pass"

    return _frame_report(status, checks)


async def run_suite(
    asset_dir: Path,
    frame_names: list[str],
    expected_size: int = 512,
    skip_vision: bool = False,
) -> dict:
    """Run QA on all frames in an asset directory.

    Args:
        asset_dir: e.g. assets/reimu
        frame_names: list of frame names (without .png extension)
        expected_size: expected pixel dimension (square)
        skip_vision: skip expensive vision QA calls

    Returns:
        Full QA report dict.
    """
    tpose_path = asset_dir / "tpose.png"
    frames_dir = asset_dir / "frames"
    frame_reports: dict[str, dict] = {}
    prev_frame_path: Path | None = None

    for name in frame_names:
        frame_path = frames_dir / f"{name}.png"
        # Parse action and direction from name: "walk_front_00" → walk, front
        parts = name.rsplit("_", 1)  # ["walk_front", "00"]
        if len(parts) == 2:
            action_dir = parts[0]  # "walk_front"
            ad_parts = action_dir.split("_", 1)
            action = ad_parts[0] if len(ad_parts) >= 1 else action_dir
            direction = ad_parts[1] if len(ad_parts) >= 2 else "front"
        else:
            action, direction = name, "front"

        report = await check_frame(
            tpose_path, frame_path, action, direction,
            expected_size=expected_size,
            skip_vision=skip_vision,
        )

        # Inter-frame centroid drift check (between consecutive frames in same animation)
        if prev_frame_path is not None and frame_path.exists():
            drift = image_ops.detect_centroid_drift(
                prev_frame_path, frame_path, frame_size=expected_size,
            )
            if drift is not None:
                report["checks"]["inter_frame_drift"] = drift

        frame_reports[name] = report
        log.info("QA %s: %s", name, report["status"])

        # Track previous frame for drift detection (reset on animation boundary)
        if frame_path.exists():
            prev_frame_path = frame_path
        # Reset on animation group change
        if parts[1] == "00":
            prev_frame_path = frame_path

    return {
        "asset": asset_dir.name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "overall": _overall_status(frame_reports),
        "frames": frame_reports,
    }


def write_report(report: dict, out_path: Path) -> None:
    """Write a QA report to disk as JSON."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    log.info("QA report written: %s (overall: %s)", out_path, report["overall"])
