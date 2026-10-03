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

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from . import chroma, image_ops

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
        return f"Reframe the {_subject(asset_type)} so its non-chroma area covers 5-95% of the canvas."
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


def _subject(asset_type: str) -> str:
    return {"character": "character", "object": "object", "effect": "effect"}.get(asset_type, "subject")


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


# ---------------------------------------------------------------------------
# Sequence checks
# ---------------------------------------------------------------------------
# Thresholds were calibrated on the bundled fixtures (assets/*): the values
# flagged and the nearest values left alone are quoted next to each constant.

# Frame difference (image_ops.frame_difference) below which two frames are
# duplicates. Flagged: reimu idle_front_02 vs _01 0.0096, sakuya idle_left_06
# vs _05 0.0145, clownfish swim_100 vs swim_00 0.0028. Left alone: subtle real
# motion such as reimu idle_front_04 vs _03 0.0195 and sakuya idle_front_03 vs
# _02 0.0213.
DUPLICATE_MAX_DIFF = 0.015
# A long, smooth animation moves little per frame (clownfish swim, 101 frames:
# 0.0069-0.0135 between neighbours), so the limit is also capped at this share
# of the animation's typical (75th percentile) step between neighbours.
DUPLICATE_STEP_SHARE = 0.45
# Box size and area must both differ from the median frame by more than this
# share, in the same direction, before a frame counts as rescaled. Requiring
# both keeps pose changes legal: a closed chest lid shortens the box to 0.84x
# while the area stays 0.95x; a crouch or a fall changes the box, not the area.
# Effects get more room for particles: fireball idle_loop_03 is 1.19x wide at
# 1.15x the area, idle_loop_05 0.81x wide at 0.91x.
SCALE_TOLERANCE = {"character": 0.15, "object": 0.15, "effect": 0.20}
# Minimum colour-histogram overlap with the median palette. Flagged: fireball
# idle_loop_03 (orange flame among blue) 0.44. Left alone: fireball idle_loop_00
# (dark aura) 0.53, clownfish die_21 0.56, chest open_front_03 (blue burst)
# 0.69, every reimu and sakuya frame 0.83 or more.
COLOUR_MIN_OVERLAP = 0.50
# A colour family must gain or lose this share of the subject to be named in a hint.
COLOUR_HINT_SHARE = 0.05
# Scale and colour compare each frame with the median of the MEDIAN_WINDOW
# frames around it: the whole animation when it is that short. Long animations
# change gradually (the 50-frame clownfish die reddens as it goes), and against
# the global median ordinary frames of it dropped to a 0.51 colour overlap.
MEDIAN_WINDOW = 7
# A median needs three frames to outvote one outlier.
MIN_FRAMES_FOR_MEDIAN = 3

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


@dataclass(frozen=True)
class _Finding:
    """One sequence failure: the check, the frames to redraw, and how."""

    check: str
    frames: tuple[str, ...]
    detail: str
    hint: str


def _sequence_checks(
    names: list[str],
    analyses: dict[str, image_ops.FrameAnalysis],
    action: str,
    asset_type: str,
) -> tuple[dict[str, dict[str, dict]], list[_Finding]]:
    """Run the sequence checks on one animation's measured frames.

    Returns per-frame check entries ({frame: {check: entry}}) and the failures.
    """
    measured = [name for name in names if name in analyses]
    entries: dict[str, dict[str, dict]] = {name: {} for name in measured}
    findings: list[_Finding] = []
    checks = [_edge_contact(measured, analyses, asset_type)]
    if len(measured) >= 2:
        checks.append(_duplicate_frames(measured, analyses, action))
    if len(measured) >= MIN_FRAMES_FOR_MEDIAN:
        checks.append(_scale_drift(measured, analyses, asset_type))
        checks.append(_colour_drift(measured, analyses))
    for check_entries, check_findings in checks:
        for name, entry in check_entries.items():
            entries[name].update(entry)
        findings.extend(check_findings)
    return entries, findings


def _edge_contact(
    names: list[str],
    analyses: dict[str, image_ops.FrameAnalysis],
    asset_type: str,
) -> tuple[dict[str, dict[str, dict]], list[_Finding]]:
    entries: dict[str, dict[str, dict]] = {}
    findings = []
    for name in names:
        sides = list(analyses[name].edge_sides)
        detail = "OK"
        if sides:
            edges = _join(sides)
            detail = f"Subject touches the {edges} edge"
            findings.append(_Finding(
                "edge_contact",
                (name,),
                f"{name} touches the {edges} edge",
                f"Reframe {name} so the whole {_subject(asset_type)} stays inside the canvas with about 10% "
                f"padding; it is cropped at the {edges} edge.",
            ))
        entries[name] = {"edge_contact": {"pass": not sides, "sides": sides, "detail": detail}}
    return entries, findings


def _duplicate_frames(
    names: list[str],
    analyses: dict[str, image_ops.FrameAnalysis],
    action: str,
) -> tuple[dict[str, dict[str, dict]], list[_Finding]]:
    """Flag frames that repeat an earlier frame, or the whole animation when nothing moves."""
    thumbs = [analyses[name].thumbnail for name in names]
    count = len(names)
    diff = np.zeros((count, count))
    for i in range(count):
        for j in range(i):
            diff[i, j] = diff[j, i] = image_ops.frame_difference(thumbs[i], thumbs[j])
    largest = float(diff.max())
    entries: dict[str, dict[str, dict]] = {}

    if largest < DUPLICATE_MAX_DIFF:
        detail = f"No motion: all {count} frames are near-identical (largest difference {largest:.4f} < {DUPLICATE_MAX_DIFF})"
        for i, name in enumerate(names[1:], start=1):
            entries[name] = {"duplicate_frame": {
                "pass": False, "nearest": names[0], "diff": round(float(diff[i, 0]), 4),
                "limit": DUPLICATE_MAX_DIFF, "detail": detail,
            }}
        hint = (
            f"Regenerate {_frame_range(names[1:])} as successive phases of the {action} motion: all {count} frames "
            f"are near-identical to {names[0]}. Keep {names[0]} and make every later frame visibly different."
        )
        return entries, [_Finding("no_motion", tuple(names[1:]), detail, hint)]

    steps = [float(diff[i + 1, i]) for i in range(count - 1)]
    limit = min(DUPLICATE_MAX_DIFF, DUPLICATE_STEP_SHARE * float(np.percentile(steps, 75)))
    findings = []
    for i in range(1, count):
        j = int(np.argmin(diff[i, :i]))
        value = float(diff[i, j])
        ok = value >= limit
        name, original = names[i], names[j]
        detail = "OK" if ok else f"Near-identical to {original} (difference {value:.4f} < {limit:.4f})"
        entries[name] = {"duplicate_frame": {
            "pass": ok, "nearest": original, "diff": round(value, 4), "limit": round(limit, 4), "detail": detail,
        }}
        if ok:
            continue
        if i == count - 1 and j == 0 and count >= MIN_FRAMES_FOR_MEDIAN:
            hint = (
                f"Redraw {name} as the step leading back into {original}, not a copy of it; when "
                f"the animation loops, the copy shows the same pose twice."
            )
        else:
            neighbours = f"between {names[i - 1]} and {names[i + 1]}" if i + 1 < count else f"after {names[i - 1]}"
            hint = f"Redraw {name} as a distinct {action} phase {neighbours}; it duplicates {original}."
        findings.append(_Finding("duplicate_frame", (name,), f"{name} duplicates {original}", hint))
    return entries, findings


def _window(index: int, count: int) -> slice:
    """The MEDIAN_WINDOW frames around `index`, shifted inwards at either end."""
    start = min(max(index - MEDIAN_WINDOW // 2, 0), max(count - MEDIAN_WINDOW, 0))
    return slice(start, min(start + MEDIAN_WINDOW, count))


def _local_median(values: np.ndarray, index: int) -> np.ndarray:
    return np.median(values[_window(index, len(values))], axis=0)


def _scale_drift(
    names: list[str],
    analyses: dict[str, image_ops.FrameAnalysis],
    asset_type: str,
) -> tuple[dict[str, dict[str, dict]], list[_Finding]]:
    """Flag frames whose subject box and area both move away from the median frame."""
    tolerance = SCALE_TOLERANCE.get(asset_type, SCALE_TOLERANCE["character"])
    boxes = [analyses[name].bbox for name in names]
    heights = np.array([(b[3] - b[1]) / analyses[n].height for n, b in zip(names, boxes)])
    widths = np.array([(b[2] - b[0]) / analyses[n].width for n, b in zip(names, boxes)])
    areas = np.array([analyses[name].coverage for name in names])

    entries: dict[str, dict[str, dict]] = {}
    findings = []
    for i, name in enumerate(names):
        height = float(heights[i] / _local_median(heights, i))
        width = float(widths[i] / _local_median(widths, i))
        area = float(np.sqrt(areas[i] / _local_median(areas, i)))
        # Effects may grow sideways, so their box uses whichever side moved most.
        box = width if asset_type == "effect" and abs(width - 1) > abs(height - 1) else height
        drifted = abs(box - 1) > tolerance and abs(area - 1) > tolerance and (box - 1) * (area - 1) > 0
        entry: dict[str, Any] = {
            "pass": not drifted,
            "height_ratio": round(height, 3),
            "area_ratio": round(area, 3),
            "tolerance": tolerance,
        }
        if asset_type == "effect":
            entry["width_ratio"] = round(width, 3)
        detail = "OK"
        if drifted:
            change = f"{abs(area - 1):.0%} {'larger' if area > 1 else 'smaller'}"
            detail = (
                f"Subject {change} than the median frame "
                f"(box {box:.2f}x, area {area:.2f}x; tolerance {tolerance:.0%})"
            )
            window = _window(i, len(names))
            nearest = window.start + int(np.argmin(np.abs(areas[window] / _local_median(areas, i) - 1)))
            keep = (
                "the effect's bounding box and centre" if asset_type == "effect"
                else "the same camera distance, framing and proportions"
            )
            findings.append(_Finding(
                "scale_drift",
                (name,),
                f"{name}: {detail}",
                f"Redraw {name} at the scale of {names[nearest]}: its {_subject(asset_type)} is drawn {change} "
                f"than the rest of the animation. Keep {keep}.",
            ))
        entry["detail"] = detail
        entries[name] = {"scale_drift": entry}
    return entries, findings


def _colour_drift(
    names: list[str],
    analyses: dict[str, image_ops.FrameAnalysis],
) -> tuple[dict[str, dict[str, dict]], list[_Finding]]:
    """Flag frames whose subject palette overlaps too little with the median palette."""
    histograms = np.stack([analyses[name].histogram for name in names])
    families = np.stack([analyses[name].colour_families for name in names])

    entries: dict[str, dict[str, dict]] = {}
    findings = []
    for i, name in enumerate(names):
        median = _normalised(_local_median(histograms, i))
        overlap = image_ops.histogram_overlap(histograms[i], median)
        ok = overlap >= COLOUR_MIN_OVERLAP
        detail = "OK" if ok else (
            f"Palette overlaps the median palette by {overlap:.2f} (minimum {COLOUR_MIN_OVERLAP})"
        )
        entries[name] = {"colour_drift": {"pass": ok, "overlap": round(overlap, 3), "detail": detail}}
        if ok:
            continue
        window = range(*_window(i, len(names)).indices(len(names)))
        best = max((j for j in window if j != i), key=lambda j: image_ops.histogram_overlap(histograms[j], median))
        hint = _palette_hint(name, names[best], families[i], _normalised(_local_median(families, i)), families[best])
        findings.append(_Finding("colour_drift", (name,), f"{name}: {detail}", hint))
    return entries, findings


def _normalised(histogram: np.ndarray) -> np.ndarray:
    return histogram / max(float(histogram.sum()), 1e-9)


def _palette_hint(
    name: str,
    reference: str,
    shares: np.ndarray,
    median_shares: np.ndarray,
    reference_shares: np.ndarray,
) -> str:
    """Name the colours to keep, drop and rebalance so an image model can match the palette."""
    names = image_ops.COLOUR_FAMILIES
    delta = shares - median_shares
    gained = [i for i in np.argsort(-delta) if delta[i] >= COLOUR_HINT_SHARE]
    foreign = [i for i in gained if reference_shares[i] < COLOUR_HINT_SHARE]
    stronger = [names[i] for i in gained if i not in foreign]
    weaker = [names[i] for i in np.argsort(delta) if -delta[i] >= COLOUR_HINT_SHARE]
    main = [names[i] for i in np.argsort(-reference_shares)[:3] if reference_shares[i] >= 0.15]

    text = f"Match {name}'s palette to {reference}"
    if main:
        text += f": mostly {_join(main)}"
    if foreign:
        share = float(sum(delta[i] for i in foreign))
        change = f"without the {_join([names[i] for i in foreign])} areas ({share:.0%} of the subject)"
    else:
        change = " and ".join(part for part in (
            f"more {_join(weaker)}" if weaker else "",
            f"less {_join(stronger)}" if stronger else "",
        ) if part)
    if change:
        text += (", " if main else ": ") + change
    elif not main:
        text += ": same hues and brightness as the rest of the animation"
    return text + "."


def _join(words: list[str]) -> str:
    """'a', 'a and b', 'a, b and c'."""
    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"


def _frame_range(names: list[str]) -> str:
    """Name a list of frames compactly: 'a', 'a and b', or 'a to z' for a declared run."""
    if len(names) <= 2:
        return _join(names)
    return f"{names[0]} to {names[-1]}"


def _animation_report(
    names: list[str],
    frame_reports: dict[str, dict],
    findings: list[_Finding],
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


def _parse_frame_name(name: str) -> tuple[str, str, str]:
    """Return (animation, action, direction) for "walk_front_00" -> walk_front, walk, front."""
    parts = name.rsplit("_", 1)  # ["walk_front", "00"]
    animation = parts[0] if len(parts) == 2 and parts[1].isdigit() else name
    if len(parts) == 2:
        ad_parts = parts[0].split("_", 1)
        action = ad_parts[0]
        direction = ad_parts[1] if len(ad_parts) >= 2 else "front"
    else:
        action, direction = name, "front"
    return animation, action, direction


async def run_suite(
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
    tpose_path = asset_dir / "tpose.png"
    frames_dir = asset_dir / "frames"
    frame_reports: dict[str, dict] = {}
    analyses: dict[str, image_ops.FrameAnalysis] = {}
    animations: dict[str, list[str]] = {}
    actions: dict[str, str] = {}
    prev_centroid: tuple[float, float] | None = None
    prev_animation: str | None = None

    for name in frame_names:
        frame_path = frames_dir / f"{name}.png"
        animation, action, direction = _parse_frame_name(name)
        animations.setdefault(animation, []).append(name)
        actions.setdefault(animation, action)

        report = await check_frame(
            tpose_path, frame_path, action, direction,
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
        entries, findings = _sequence_checks(names, analyses, actions[animation], asset_type)
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


def _apply_findings(frame_reports: dict[str, dict], findings: list[_Finding], asset_type: str) -> None:
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
