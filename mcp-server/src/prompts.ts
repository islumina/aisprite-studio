// Every prompt an image agent receives: frame, row, animation outline and
// reference tasks. Pure text builders; workspace.ts adds files and references.
import { frameName, type AssetRequest, type FrameSpec } from "./request.js";

/** Grid of a row task, as tools/sprite_pipeline/row.py plans it. */
export interface RowLayout {
  frames: number;
  columns: number;
  rows: number;
  slot: number;
  canvas: [number, number];
}

// Pose outline per action, indexed by frame and wrapping when an animation has more frames.
const POSES: Readonly<Record<string, readonly string[]>> = {
  idle: [
    "neutral resting pose, arms relaxed at sides, clothes begin to flutter very slightly",
    "slight inhale, chest rises slightly, cloth drifts leftward",
    "breathing in, cloth ripples slightly more",
    "peak of breath, a touch taller",
    "beginning to exhale, cloth drifting back toward centre",
    "mid-exhale, cloth settling",
    "exhaling further, chest lowering",
    "returning to neutral, bridging back into frame 0 without duplicating it",
  ],
  walk: ["contact: lead foot forward, opposite arm forward", "passing: legs crossing, body low", "opposite contact: other foot forward", "passing: legs crossing", "high point of the stride", "recovery: bridging back into frame 0 without duplicating it"],
  run: ["contact: lead foot strikes the ground, body leans forward", "drive: push off, back leg extends", "float: both feet briefly off the ground", "contact: opposite foot strikes", "drive: opposite push-off", "recovery: bridging back into frame 0 without duplicating it"],
  attack: ["wind-up: lean back, weapon raised", "strike: lunge forward, weapon swung (strongest pose)", "follow-through: weapon low, body still forward", "recovery: settle toward the idle pose"],
  cast: ["hands rising, energy gathering", "arms extended, magic circle visible at its peak", "release: burst of energy outward", "arms lowering, residual glow fading"],
  jump: ["crouch: knees bent, preparing to spring", "ascend: body rising, arms up", "apex: highest point, brief float", "descend: falling, arms adjusting", "land: impact, knees absorbing"],
  hurt: ["initial recoil: body jerks back, pain expression", "maximum stagger: leaning away", "recovery: returning toward upright"],
  die: ["first hit: flinching, eyes closed", "buckling: knees giving way", "falling: body tilting", "on the ground: collapsed, motionless"],
  open: ["closed: fully shut", "crack: first gap appears, a hint of the contents", "half-open: lid or door at its midpoint", "wide open: contents revealed", "settle: slight bounce back from open", "final rest: fully open and still"],
  close: ["open: starting fully open", "beginning to close", "half-closed: midpoint", "nearly shut: small gap remaining", "fully closed"],
  shine: ["sparkles at positions A: scattered glints", "sparkles at positions B: shifted glints, brighter core", "sparkles at positions C: peak brightness", "sparkles at positions D: dimming, bridging back into frame 0 without duplicating it"],
  activate: ["mechanism at rest", "trigger: initial movement begins", "mid-action: mechanism in motion", "engaged: mechanism reaches its final position"],
  burn: ["flame tongues leaning left, bright core", "flame tongues leaning right, wider spread", "tall narrow flame, intense core", "broad low flame, embers rising", "medium flame, sparks scattering", "returning toward the frame 0 shape without duplicating it"],
  explode: ["origin: tiny bright core", "first expansion: ring of debris outward", "peak: maximum radius, bright flash", "dissipating: fading edges, smoke wisps", "remnants: scattered particles, dim glow"],
  magic: ["rune circle at rest: base pattern visible", "rotated 90 degrees, glow intensifying", "rotated 180 degrees, peak brightness", "rotated 270 degrees, glow fading", "returning to the base orientation without duplicating frame 0"],
  heal: ["first particles rising from below", "more particles, glow spreading upward", "peak: dense particle cloud, brightest glow", "particles fading, glow dimming, bridging back into frame 0"],
  hit: ["impact flash: bright star at the centre", "spark burst: lines radiating outward", "dissipating: sparks fading, lines shortening"],
};

const FACING: Readonly<Record<string, string>> = {
  front: "facing the viewer (front view)",
  back: "seen from behind (back view)",
  left: "in side profile facing left",
  right: "in side profile facing right",
};

const FRAME_RULES = {
  character: "Preserve the same face, outfit, colours, and proportions. Animate the pose; do not return a T-pose.",
  object: "Keep the object's main body pixel-aligned with the reference; change only dynamic parts.",
  effect: "Keep the palette, style, centre, and bounding box consistent while particle details may vary.",
} as const;

const BACKGROUND_RULE = "Use one flat, solid green screen (#00FF00), or solid blue (#0000FF) only when the subject is mostly green.";
const LIGHTING_RULE = "Use flat even lighting, absolutely no shadows or ground plane, no scenery, no detached effects, and no green/blue colour spill on the subject. Centre the subject with about 10% padding. Output only the image.";

export function poseFor(frame: FrameSpec): string {
  const cycle = POSES[frame.action.toLowerCase()];
  const pose = cycle ? cycle[frame.index % cycle.length] : undefined;
  return pose ?? `phase ${frame.index + 1} of ${frame.total} of the '${frame.action}' motion`;
}

export function framePrompt(asset: string, request: AssetRequest, frame: FrameSpec): string {
  const facing = facingOf(frame);
  const continuity = frame.index === 0
    ? "Establish scale, framing, and palette from the canonical reference."
    : `Continue motion from ${frameName(frame.action, frame.direction, frame.index - 1)}.png without changing identity or scale.`;
  return [
    `Generate ${frame.name}.png, frame ${frame.index + 1} of ${frame.total} of the '${frame.action}' animation${facing ? `, ${facing}` : ""}.`,
    `Subject: ${asset}. Asset type: ${request.asset_type}. Style: ${request.style}.`,
    FRAME_RULES[request.asset_type],
    `Pose: ${poseFor(frame)}.`,
    "Treat references as identity guidance only and do not copy their visible defects.",
    continuity,
    `Output exactly ${request.frame_size}x${request.frame_size} PNG. ${BACKGROUND_RULE}`,
    LIGHTING_RULE,
  ].join("\n");
}

function facingOf(frame: FrameSpec): string {
  return FACING[frame.direction] ?? (frame.direction ? `facing '${frame.direction}'` : "");
}

const REFERENCE_RULES = {
  character: "Create one neutral full-body front reference pose with stable face, outfit, colours, proportions, and a readable silhouette.",
  object: "Create the canonical static base state, such as closed or off, with all reusable body geometry clearly visible.",
  effect: "Create one representative canonical effect frame with a stable palette, centre, scale, and bounding box.",
} as const;

export const REFERENCE_WARNING = "Existing generated images are unapproved failure artifacts. Prefer input.png for identity; use tpose.png only as repair context and do not preserve its defects.";

export function referencePrompt(asset: string, request: AssetRequest): string {
  return [
    `Generate a replacement tpose.png for '${asset}'. Asset type: ${request.asset_type}. Style: ${request.style}.`,
    REFERENCE_RULES[request.asset_type],
    REFERENCE_WARNING,
    `Output exactly ${request.frame_size}x${request.frame_size} PNG. ${BACKGROUND_RULE}`,
    LIGHTING_RULE,
  ].join("\n");
}

export function animationPrompt(asset: string, request: AssetRequest, frames: FrameSpec[]): string {
  const first = frames[0]!;
  const facing = facingOf(first);
  return [
    `Animation '${first.animation}' of ${asset}: ${frames.length} frames${facing ? `, ${facing}` : ""}. Asset type: ${request.asset_type}. Style: ${request.style}.`,
    FRAME_RULES[request.asset_type],
    "Generate each frame as its own PNG with the exact name below; frame 0 sets scale, framing, and palette.",
    ...frames.map((frame) => `  ${frame.name}: ${poseFor(frame)}`),
    `Output exactly ${request.frame_size}x${request.frame_size} PNG per frame. ${BACKGROUND_RULE}`,
    LIGHTING_RULE,
  ].join("\n");
}

export function rowPrompt(asset: string, request: AssetRequest, frames: FrameSpec[], layout: RowLayout): string {
  const first = frames[0]!;
  const facing = facingOf(first);
  const order = layout.rows > 1 ? "left to right, then top to bottom" : "left to right";
  const floor = request.asset_type === "effect" ? "centred in" : "standing on the floor line of";
  return [
    `Draw all ${frames.length} frames of the '${first.action}' animation of ${asset}${facing ? `, ${facing}` : ""}, in ONE ${layout.canvas[0]}x${layout.canvas[1]} image: ${layout.columns} per row, ${layout.rows} row(s), in reading order (${order}).`,
    `Subject: ${asset}. Asset type: ${request.asset_type}. Style: ${request.style}.`,
    FRAME_RULES[request.asset_type],
    `The attached layout guide shows the numbered boxes. Draw pose k inside box k, within its inner safe area and ${floor} its box. Do not draw the boxes, lines, or numbers.`,
    "Every pose shows the same subject at the same scale; only the pose changes. Keep clear background between neighbouring poses: no pose may touch another pose or the image edge.",
    "Treat references as identity guidance only and do not copy their visible defects.",
    "Poses:",
    ...frames.map((frame, index) => `  ${index + 1}. ${frame.name}: ${poseFor(frame)}`),
    BACKGROUND_RULE.replace("Use one flat, solid", "Fill the whole image with one flat, solid"),
    LIGHTING_RULE,
  ].join("\n");
}
