"""request.yml → frame list. The single place frame names are built."""

from __future__ import annotations


def animation_name(action: str, direction: str) -> str:
    """Animation key: `walk_front`, or just `swim` when the request has no direction."""
    return f"{action}_{direction}" if direction else action


def frame_name(action: str, direction: str, index: int) -> str:
    """Frame file stem: `walk_front_03`, or `swim_03` when the request has no direction."""
    return f"{animation_name(action, direction)}_{index:02d}"


def frame_specs(request: dict) -> list[dict]:
    """Flatten request.yml animations into ordered frame specs."""
    specs = []
    for anim in request.get("animations", []):
        action = anim["action"]
        direction = anim.get("direction") or ""
        total = anim.get("frames", 4)
        for i in range(total):
            specs.append({
                "name": frame_name(action, direction, i),
                "animation": animation_name(action, direction),
                "action": action,
                "direction": direction,
                "index": i,
                "total": total,
                "fps": anim.get("fps"),
            })
    return specs
