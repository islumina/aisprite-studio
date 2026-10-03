"""Build host-neutral sprite generation plans for image-capable agents."""

from __future__ import annotations

from pathlib import Path

from .spec import frame_name

# ---------------------------------------------------------------------------
# Prompt helpers
# ---------------------------------------------------------------------------

_FRAME_PROMPT = (
    "Generate animation frame {index} of {total} for a \"{action}\" animation.\n"
    "Subject: {asset_name} ({style}, {asset_type}).\n"
    "Facing: {direction}\n"
    "{category_rule}\n"
    "Pose/State: {pose_desc}\n"
    "{continuity_note}\n"
    "Background: If subject is mostly green use solid #0000FF blue screen, if mostly blue use #00FF00 green screen, otherwise use #00FF00 green screen. No shadows or ground plane.\n"
    "Frame the subject centred with ~10% padding. Output only the image."
)

_CATEGORY_RULES = {
    "character": "The attached T-Pose or reference images are for DETAIL REFERENCE ONLY (to copy clothing, colors, style, and proportions). DO NOT generate the character standing in a T-Pose. Animate the character into the specified pose below.",
    "object": "The object's main body must stay perfectly static and aligned with the reference. Only specified dynamic parts should change.",
    "effect": "Maintain the same colour palette, style, and bounding box as the reference. Particle details will vary.",
}

POSE_DESCRIPTIONS: dict[str, list[str]] = {
    "idle": [
        "neutral resting pose, arms relaxed at sides, clothes and skirt begin to flutter very slightly in the gentle breeze",
        "neutral resting pose, arms relaxed at sides, slight inhale, chest rises slightly, cloth drifts leftward",
        "neutral resting pose, arms relaxed at sides, breathing in, skirt ripples slightly more in the breeze",
        "neutral resting pose, arms relaxed at sides, peak of breath, a touch taller, clothes fluttering gracefully",
        "neutral resting pose, arms relaxed at sides, beginning to exhale, cloth drifting back toward center",
        "neutral resting pose, arms relaxed at sides, mid-exhale, skirt settling down slightly",
        "neutral resting pose, arms relaxed at sides, exhaling further, chest lowering",
        "neutral resting pose, arms relaxed at sides, returning to neutral, clothes settle (transitional frame before restarting loop, do NOT duplicate frame 0)"
    ],
    "walk": ['contact — lead foot forward, opposite arm forward', 'passing/down — legs crossing, body low', 'opposite contact — other foot forward', 'passing/down — legs crossing', 'high point of the stride', 'recovery — bridging back into frame 0 (transitional frame, do NOT duplicate frame 0)'],
    "run": ['contact — lead foot strikes ground, body leans forward', 'drive — push off, back leg extends', 'float — both feet off ground briefly', 'contact — opposite foot strikes', 'drive — opposite push off', 'recovery — bridging back into frame 0 (transitional frame, do NOT duplicate frame 0)'],
    "attack": ['wind-up — lean back, weapon raised', 'strike — lunge forward, weapon swung (strongest pose)', 'follow-through — weapon low, body still forward', 'recovery — settle toward the idle pose'],
    "cast": ['hands rising, energy gathering', 'arms extended, magic circle visible at peak', 'release — burst of energy outward', 'arms lowering, residual glow fading'],
    "jump": ['crouch — knees bent, preparing to spring', 'ascend — body rising, arms up', 'apex — highest point, brief float', 'descend — falling, arms adjusting', 'land — impact, knees absorbing'],
    "hurt": ['initial recoil — body jerks back, pain expression', 'maximum stagger — leaning away', 'recovery — returning toward upright'],
    "die": ['first hit — flinching, eyes closed', 'buckling — knees giving way', 'falling — body tilting', 'on ground — collapsed, motionless'],
    "open": ['closed — initial state, fully shut', 'crack — first gap appears, hint of contents', 'half-open — lid/door at midpoint, contents partially visible', 'wide-open — fully open, contents revealed', 'settle — slight bounce back from open', 'final resting — fully open and still'],
    "close": ['open — starting from fully open', 'beginning to close — lid/door starts moving', 'half-closed — midpoint', 'nearly shut — small gap remaining', 'click — fully closed'],
    "shine": ['sparkle positions A — scattered glints', 'sparkle positions B — shifted glints, brighter core', 'sparkle positions C — peak brightness', 'sparkle positions D — dimming, new positions (transitional frame, do NOT duplicate frame 0)'],
    "activate": ['idle state — mechanism at rest', 'trigger — initial movement begins', 'mid-action — mechanism in motion', 'engaged — mechanism reaches final position'],
    "burn": ['flame tongues leaning left, bright core', 'flame tongues leaning right, wider spread', 'tall narrow flame, intense core', 'broad low flame, embers rising', 'medium flame, sparks scattering', 'return toward frame 0 shape (transitional frame, do NOT duplicate frame 0)'],
    "explode": ['origin point — tiny bright core', 'first expansion — ring of debris outward', 'peak — maximum radius, bright flash', 'dissipating — fading edges, smoke wisps', 'remnants — scattered particles, dim glow'],
    "magic": ['rune/circle at rest — base pattern visible', 'rotation phase A — 90° turn, glow intensifying', 'rotation phase B — 180°, peak brightness', 'rotation phase C — 270°, glow fading', 'return to base orientation (transitional frame, do NOT duplicate frame 0)'],
    "heal": ['first particles rising from below', 'more particles, green/gold glow spreading upward', 'peak — dense particle cloud, brightest glow', 'particles fading, glow dimming (transitional frame, do NOT duplicate frame 0)'],
    "hit": ['impact flash — bright star at centre', 'spark burst — radiating lines outward', 'dissipating — sparks fading, lines shortening'],
}


def _pose_desc(action: str, index: int, total: int) -> str:
    """Look up a human-readable pose description for the given frame."""
    base_action = action.split("_")[0]  # "walk_front" → "walk"
    cycle = POSE_DESCRIPTIONS.get(base_action)
    if cycle:
        return cycle[index % len(cycle)]
    return f"frame {index + 1} of {total} for {base_action} animation"


def build_generation_plan(asset_dir: Path) -> str:
    """Build a detailed text plan containing the exact prompts needed by the AI Assistant."""
    import yaml
    
    req_path = asset_dir / "request.yml"
    if not req_path.exists():
        return f"Error: {req_path} not found"
        
    with open(req_path) as f:
        request = yaml.safe_load(f)
        
    asset_name = asset_dir.name
    asset_type = request.get("asset_type", "character")
    style = request.get("style", "3d cartoon game style")
    
    # Check which frames are already generated
    frames_dir = asset_dir / "frames"
    existing_frames = set()
    if frames_dir.exists():
        for f in frames_dir.glob("*.png"):
            existing_frames.add(f.stem)
            
    plan_lines = [
        f"Target Asset: {asset_name}",
        f"Asset Type: {asset_type}",
        f"Style: {style}",
        "Reference Images Required:",
        f"  - Priority 1: assets/{asset_name}/tpose.png",
    ]
    
    if asset_type == "character":
        plan_lines.append("  - Priority 2 (Continuity): Frame 00 of the same animation")
        plan_lines.append("  - Priority 3 (Continuity): The immediately previous frame (N-1)")
    else:
        plan_lines.append("  - Optimization: For objects/effects, skip Frame 00 and Frame N-1.")
        plan_lines.append("  - Keep one agent responsible for the full sequence to preserve visual continuity.")
        
    plan_lines.append("\nPending Frames to Generate:")
    
    missing_count = 0
    for anim in request.get("animations", []):
        action = anim["action"]
        direction = anim.get("direction") or ""
        total = anim.get("frames", 4)
        for i in range(total):
            name = frame_name(action, direction, i)
            if name in existing_frames:
                continue
                
            missing_count += 1
            if i == 0:
                continuity = "This is the FIRST FRAME. Establish the size, framing, and palette based on the reference image."
            else:
                continuity = f"This is NOT the first frame. You MUST heavily reference the previous frame ({frame_name(action, direction, i - 1)}) to generate the next coherent motion in the sequence."

            prompt_text = _FRAME_PROMPT.format(
                index=i + 1,
                total=total,
                action=action,
                direction=direction or "as in the reference",
                asset_name=asset_name,
                asset_type=asset_type,
                style=style,
                category_rule=_CATEGORY_RULES.get(asset_type, _CATEGORY_RULES["character"]),
                pose_desc=_pose_desc(action, i, total),
                continuity_note=continuity,
            )
            
            plan_lines.append(f"\n[{name}]")
            plan_lines.append(prompt_text)
            
    if missing_count == 0:
        return "All frames in request.yml have already been generated!"
        
    return "\n".join(plan_lines)
