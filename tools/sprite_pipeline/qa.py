"""QA runner for generated sprite frames.

Frame checks (in order of cost):
1. File existence and valid PNG
2. Dimension match
3. Chroma key and subject coverage, measured on the keyed frame
4. Centroid drift against the previous frame of the same animation
5. Visual review by a connected image-capable agent or human reviewer

Sequence checks, per animation, from the same keyed read of each frame:
6. Duplicate frames (including a last frame that copies frame 0) and no motion
7. Scale drift and colour drift against the animation's median frame
8. Edge contact: the subject touches the canvas edge and is cropped

Each animation gets a 0-100 score and repair hints; the report's `score` is the
lowest animation score, because packing needs every animation to pass. The
score is deterministic only: 100 never means visual approval.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from . import chroma, image_ops
from .qa_sequence import Finding, sequence_checks, subject_word

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
    found = image_ops.image_format(frame_path)
    valid = found == "PNG"
    result = {"exists": frame_path.exists(), "valid_png": valid, "pass": valid}
    if found and not valid:
        result["detail"] = f"File is {found} data, not PNG"
    return result


def _check_dimensions(frame_path: Path, expected: int) -> dict:
    dims = image_ops.get_dimensions(frame_path)
    if dims is None:
        return {"w": None, "h": None, "pass": False}
    return {
        "w": dims[0],
        "h": dims[1],
        "pass": dims[0] == expected and dims[1] == expected,
    }


def _check_key(analysis: image_ops.FrameAnalysis | None) -> dict:
    if analysis is None:
        return {"pass": False, "detail": "Unreadable image"}
    if analysis.key_error:
        return {"pass": False, "detail": f"Cannot key background: {analysis.key_error}"}
    if analysis.key is None:
        return {"pass": True, "key": None, "detail": "Already transparent"}
    family = chroma.key_family(np.asarray(analysis.key, dtype=np.float32))
    return {"pass": True, "key": "#%02x%02x%02x" % analysis.key, "family": family, "detail": "OK"}


def _check_alpha(analysis: image_ops.FrameAnalysis) -> dict:
    coverage = analysis.coverage
    # The subject should cover 5-95% of the frame area
    ok = 0.05 <= coverage <= 0.95
    return {
        "ratio": round(coverage, 3),
        "pass": ok,
        "detail": "OK" if ok else f"Coverage {coverage:.1%} outside 5-95% range",
    }


# Frame checks in QA-cost order; the first failing one gives the repair hint.
FRAME_CHECKS = ("exists", "dimensions", "chroma_key", "alpha_coverage", "inter_frame_drift")


def _check_hint(name: str, check: dict, asset_type: str) -> str | None:
    """Repair for one failed frame check."""
    if name == "exists":
        if check.get("detail"):
            return "Re-export the frame as a real PNG; a renamed JPEG has no alpha and adds compression fringes."
        return "Regenerate the missing or invalid PNG frame."
    if name == "dimensions":
        return "Regenerate at the exact square frame_size declared in request.yml."
    if name == "chroma_key":
        return "Regenerate on one flat, solid chroma-key colour with no gradient, shadow, floor or scenery."
    if name == "alpha_coverage":
        return f"Reframe the {subject_word(asset_type)} so its non-chroma area covers 5-95% of the canvas."
    if name == "inter_frame_drift":
        if asset_type == "object":
            return "Realign the static object body to the previous frame; change only dynamic parts."
        if asset_type == "effect":
            return "Restore the effect's shared bounding box and centre while preserving particle variation."
        return "Realign the character scale, baseline, and body centre to the previous frame."
    return None


def _repair_hint(checks: dict[str, Any], asset_type: str) -> str | None:
    """Return the first actionable repair, ordered by QA cost."""
    for name in FRAME_CHECKS:
        if not checks.get(name, {}).get("pass", True):
            return _check_hint(name, checks[name], asset_type)
    return None


# ---------------------------------------------------------------------------
# Full QA suite
# ---------------------------------------------------------------------------

def check_frame(
    frame_path: Path,
    expected_size: int = 512,
    skip_vision: bool = False,
    asset_type: str = "character",
) -> dict:
    """Run all single-frame QA checks.

    Returns a frame report dict. The subject centroid ("_centroid") and the keyed
    frame analysis ("_analysis") ride along for the suite's drift and sequence
    checks and are removed before the report is written.
    """
    checks: dict[str, Any] = {}

    # 1. Existence
    checks["exists"] = _check_exists(frame_path)
    if not checks["exists"]["pass"]:
        result = _frame_report("fail", checks)
        result["repair_hint"] = _repair_hint(checks, asset_type)
        # A decodable non-PNG (a renamed JPEG) already fails, but its pixels still
        # tell the sequence checks whether it duplicates or recolours its siblings.
        if checks["exists"].get("detail"):
            result["_analysis"] = image_ops.analyse_frame(frame_path)
        return result

    # 2. Dimensions
    checks["dimensions"] = _check_dimensions(frame_path, expected_size)

    # 3. Key and coverage, from one keyed read of the frame
    analysis = image_ops.analyse_frame(frame_path)
    checks["chroma_key"] = _check_key(analysis)
    centroid = None
    if checks["chroma_key"]["pass"]:
        checks["alpha_coverage"] = _check_alpha(analysis)
        centroid = analysis.centroid

    critical_fail = not all(checks[name]["pass"] for name in ("dimensions", "chroma_key")) or not checks.get(
        "alpha_coverage", {}
    ).get("pass", True)

    # 4. Vision QA (skip if early failures or explicitly disabled)
    if not critical_fail and not skip_vision:
        # Vision QA is intentionally external. Never report a visual pass when
        # only deterministic checks have run.
        checks["vision_qa"] = {
            "status": "pending",
            "detail": "Pending visual review by the AI assistant",
        }

    result = _frame_report(_frame_status(checks), checks)
    hint = _repair_hint(checks, asset_type)
    if hint:
        result["repair_hint"] = hint
    result["_centroid"] = centroid
    result["_analysis"] = analysis
    return result


def _frame_status(checks: dict[str, Any]) -> str:
    has_fail = any(
        not c.get("pass", True)
        for c in checks.values()
        if isinstance(c, dict) and "pass" in c
    )
    has_pending = any(
        c.get("status") == "pending"
        for c in checks.values()
        if isinstance(c, dict)
    )
    return "fail" if has_fail else "warn" if has_pending else "pass"


# Points an animation loses per affected frame, and the most one check can cost.
SCORE_PENALTIES: dict[str, tuple[int, int]] = {
    "exists": (20, 60),
    "dimensions": (20, 60),
    "chroma_key": (20, 60),
    "alpha_coverage": (10, 40),
    "inter_frame_drift": (10, 30),
    "no_motion": (60, 60),
    "duplicate_frame": (15, 45),
    "scale_drift": (10, 30),
    "colour_drift": (10, 30),
    "edge_contact": (10, 30),
}


def _animation_report(
    names: list[str],
    frame_reports: dict[str, dict],
    findings: list[Finding],
    asset_type: str,
) -> dict:
    """Score one animation and collect its issues and hints.

    The score starts at 100 and loses SCORE_PENALTIES points per affected frame
    for every failed check, frame checks included, capped per check.
    """
    issues: list[dict] = []
    hints: list[str] = []
    affected: dict[str, set[str]] = {}

    for check in FRAME_CHECKS:
        failed = [n for n in names if not frame_reports[n]["checks"].get(check, {}).get("pass", True)]
        if not failed:
            continue
        affected[check] = set(failed)
        details = list(dict.fromkeys(_frame_check_detail(check, frame_reports[n]["checks"][check]) for n in failed))
        issues.append({"check": check, "frames": failed, "detail": _summarise(details)})
        by_hint: dict[str, list[str]] = {}
        for n in failed:
            hint = _check_hint(check, frame_reports[n]["checks"][check], asset_type)
            if hint:
                by_hint.setdefault(hint, []).append(n)
        hints.extend(f"{_frame_list(frames)}: {hint}" for hint, frames in by_hint.items())

    for check in SCORE_PENALTIES:
        own = [f for f in findings if f.check == check]
        if not own:
            continue
        frames = list(dict.fromkeys(frame for f in own for frame in f.frames))
        affected[check] = set(frames)
        issues.append({"check": check, "frames": frames, "detail": _summarise([f.detail for f in own])})
        hints.extend(f.hint for f in own)

    lost = sum(min(cap, per_frame * len(affected[check]))
               for check, (per_frame, cap) in SCORE_PENALTIES.items() if check in affected)
    return {"score": max(0, 100 - lost), "issues": issues, "hints": list(dict.fromkeys(hints))}


def _frame_check_detail(check: str, entry: dict) -> str:
    if entry.get("detail"):
        return str(entry["detail"])
    if check == "dimensions":
        return f"Frame is {entry.get('w')}x{entry.get('h')}"
    if check == "exists":
        return "Missing or unreadable PNG"
    return "Failed"


def _summarise(details: list[str], limit: int = 3) -> str:
    shown = "; ".join(details[:limit])
    return shown if len(details) <= limit else f"{shown}; and {len(details) - limit} more"


def _frame_list(names: list[str]) -> str:
    """Every frame name, so an agent can act on the list without the report."""
    return ", ".join(names)


def _parse_frame_name(name: str) -> tuple[str, str]:
    """Return (animation, action): "walk_front_00" -> walk_front, walk; "swim_03" -> swim, swim."""
    animation, _, index = name.rpartition("_")
    if not (animation and index.isdigit()):
        animation = name
    return animation, animation.split("_", 1)[0]


def run_suite(
    asset_dir: Path,
    frame_names: list[str],
    expected_size: int = 512,
    skip_vision: bool = False,
    asset_type: str = "character",
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
    frames_dir = asset_dir / "frames"
    frame_reports: dict[str, dict] = {}
    analyses: dict[str, image_ops.FrameAnalysis] = {}
    animations: dict[str, list[str]] = {}
    actions: dict[str, str] = {}
    prev_centroid: tuple[float, float] | None = None
    prev_animation: str | None = None

    for name in frame_names:
        frame_path = frames_dir / f"{name}.png"
        animation, action = _parse_frame_name(name)
        animations.setdefault(animation, []).append(name)
        actions.setdefault(animation, action)

        report = check_frame(
            frame_path,
            expected_size=expected_size,
            skip_vision=skip_vision,
            asset_type=asset_type,
        )

        # Inter-frame centroid drift check (between consecutive frames in same animation)
        centroid = report.pop("_centroid", None)
        analysis = report.pop("_analysis", None)
        # Sequence checks compare usable subjects only; an empty or tiny subject
        # already fails alpha_coverage, which carries the right repair.
        usable = report["checks"].get("alpha_coverage", {}).get("pass", True)
        if analysis is not None and analysis.bbox is not None and usable:
            analyses[name] = analysis
        if centroid is not None and prev_centroid is not None and prev_animation == animation:
            drift = image_ops.centroid_drift(prev_centroid, centroid, frame_size=expected_size)
            report["checks"]["inter_frame_drift"] = drift
            if not drift["pass"]:
                report["status"] = "fail"
                report["repair_hint"] = _repair_hint(report["checks"], asset_type)

        frame_reports[name] = report

        # Track the previous centroid for drift detection (reset on animation boundary)
        if centroid is not None:
            prev_centroid = centroid
            prev_animation = animation

    animation_reports = {}
    for animation, names in animations.items():
        entries, findings = sequence_checks(names, analyses, actions[animation], asset_type)
        for name, checks in entries.items():
            frame_reports[name]["checks"].update(checks)
        _apply_findings(frame_reports, findings, asset_type)
        animation_reports[animation] = _animation_report(names, frame_reports, findings, asset_type)

    for name, report in frame_reports.items():
        log.info("QA %s: %s", name, report["status"])

    scores = [a["score"] for a in animation_reports.values()]
    return {
        "asset": asset_dir.name,
        "asset_type": asset_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "overall": _overall_status(frame_reports),
        "score": min(scores) if scores else 0,
        "animations": animation_reports,
        "frames": frame_reports,
    }


def _apply_findings(frame_reports: dict[str, dict], findings: list[Finding], asset_type: str) -> None:
    """Fail the frames named by sequence findings and append their repairs to the frame hint."""
    hints: dict[str, list[str]] = {}
    for finding in findings:
        for name in finding.frames:
            hints.setdefault(name, []).append(finding.hint)
    for name, frame_hints in hints.items():
        report = frame_reports[name]
        report["status"] = _frame_status(report["checks"])
        base = _repair_hint(report["checks"], asset_type)
        report["repair_hint"] = " ".join(dict.fromkeys(([base] if base else []) + frame_hints))


def write_report(report: dict, out_path: Path) -> None:
    """Write a QA report to disk as JSON."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    log.info("QA report written: %s (overall: %s)", out_path, report["overall"])
