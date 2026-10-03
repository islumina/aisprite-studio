"""Sequence QA: checks that compare the frames of one animation with each other.

Duplicate frames (including a last frame that copies frame 0) and no motion,
scale and colour drift against the frames around each one, and a subject that
touches the canvas edge. Each failure names the frames to redraw and how.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import image_ops

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

@dataclass(frozen=True)
class Finding:
    """One sequence failure: the check, the frames to redraw, and how."""

    check: str
    frames: tuple[str, ...]
    detail: str
    hint: str


def sequence_checks(
    names: list[str],
    analyses: dict[str, image_ops.FrameAnalysis],
    action: str,
    asset_type: str,
) -> tuple[dict[str, dict[str, dict]], list[Finding]]:
    """Run the sequence checks on one animation's measured frames.

    Returns per-frame check entries ({frame: {check: entry}}) and the failures.
    """
    measured = [name for name in names if name in analyses]
    entries: dict[str, dict[str, dict]] = {name: {} for name in measured}
    findings: list[Finding] = []
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
) -> tuple[dict[str, dict[str, dict]], list[Finding]]:
    entries: dict[str, dict[str, dict]] = {}
    findings = []
    for name in names:
        sides = list(analyses[name].edge_sides)
        detail = "OK"
        if sides:
            edges = _join(sides)
            detail = f"Subject touches the {edges} edge"
            findings.append(Finding(
                "edge_contact",
                (name,),
                f"{name} touches the {edges} edge",
                f"Reframe {name} so the whole {subject_word(asset_type)} stays inside the canvas with about 10% "
                f"padding; it is cropped at the {edges} edge.",
            ))
        entries[name] = {"edge_contact": {"pass": not sides, "sides": sides, "detail": detail}}
    return entries, findings


def _duplicate_frames(
    names: list[str],
    analyses: dict[str, image_ops.FrameAnalysis],
    action: str,
) -> tuple[dict[str, dict[str, dict]], list[Finding]]:
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
        return entries, [Finding("no_motion", tuple(names[1:]), detail, hint)]

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
        findings.append(Finding("duplicate_frame", (name,), f"{name} duplicates {original}", hint))
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
) -> tuple[dict[str, dict[str, dict]], list[Finding]]:
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
            findings.append(Finding(
                "scale_drift",
                (name,),
                f"{name}: {detail}",
                f"Redraw {name} at the scale of {names[nearest]}: its {subject_word(asset_type)} is drawn {change} "
                f"than the rest of the animation. Keep {keep}.",
            ))
        entry["detail"] = detail
        entries[name] = {"scale_drift": entry}
    return entries, findings


def _colour_drift(
    names: list[str],
    analyses: dict[str, image_ops.FrameAnalysis],
) -> tuple[dict[str, dict[str, dict]], list[Finding]]:
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
        findings.append(Finding("colour_drift", (name,), f"{name}: {detail}", hint))
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


def subject_word(asset_type: str) -> str:
    return {"character": "character", "object": "object", "effect": "effect"}.get(asset_type, "subject")
