// AI Sprite Studio — prompt builder
//
// Synthesises per-animation and per-frame generation prompts from the SINGLE
// source-of-truth template (prompts/generation-agent.md) plus the character spec.
// The editor uses this so the Animation/Frame Prompt panels always have content
// (no 404s) and the "Regenerate frame" button can copy a ready-to-paste prompt
// into an image-capable agent. Pure functions — the template text is passed in (the editor
// fetches it once; Node tests read it from disk), so this module has no I/O.

/** Fill the {{...}} placeholders in the generation-agent template. */
function fillTemplate(templateText, vars) {
  return templateText
    .replace(/\{\{frame_name\}\}/g, vars.frame_name ?? '')
    .replace(/\{\{animation_name\}\}/g, vars.animation_name ?? '')
    .replace(/\{\{pose_description\}\}/g, vars.pose_description ?? '')
    .replace(/\{\{neighbor_context\}\}/g, vars.neighbor_context ?? '');
}

/** Direction suffix → human phrase. */
function facing(animName) {
  const dir = animName.split('_').pop();
  switch (dir) {
    case 'front': return 'facing the viewer (front view)';
    case 'back': return 'seen from behind (back view)';
    case 'left': return 'side profile facing left';
    case 'right': return 'side profile facing right';
    default: return '';
  }
}

// Per-archetype frame-pose outlines. Indexed by frame, wrapping if fewer entries.
// Characters
const POSE_CYCLES = {
  idle: [
    'neutral resting pose, arms and legs completely still, clothes and skirt begin to flutter very slightly in the gentle breeze',
    'arms and legs completely still, slight inhale, chest rises slightly, cloth drifts leftward',
    'arms and legs completely still, breathing in, skirt ripples slightly more in the breeze',
    'arms and legs completely still, peak of breath, a touch taller, clothes fluttering gracefully',
    'arms and legs completely still, beginning to exhale, cloth drifting back toward center',
    'arms and legs completely still, mid-exhale, skirt settling down slightly',
    'arms and legs completely still, exhaling further, chest lowering',
    'arms and legs completely still, returning to neutral, clothes settle (loops into frame 0)'
  ],
  walk: ['contact — lead foot forward, opposite arm forward', 'passing/down — legs crossing, body low', 'opposite contact — other foot forward', 'passing/down — legs crossing', 'high point of the stride', 'recovery — bridging back into frame 0'],
  run: ['contact — lead foot strikes ground, body leans forward', 'drive — push off, back leg extends', 'float — both feet off ground briefly', 'contact — opposite foot strikes', 'drive — opposite push off', 'recovery — bridging back into frame 0'],
  attack: ['wind-up — lean back, weapon raised', 'strike — lunge forward, weapon swung (strongest pose)', 'follow-through — weapon low, body still forward', 'recovery — settle toward the idle pose'],
  cast: ['hands rising, energy gathering', 'arms extended, magic circle visible at peak', 'release — burst of energy outward', 'arms lowering, residual glow fading'],
  jump: ['crouch — knees bent, preparing to spring', 'ascend — body rising, arms up', 'apex — highest point, brief float', 'descend — falling, arms adjusting', 'land — impact, knees absorbing'],
  hurt: ['initial recoil — body jerks back, pain expression', 'maximum stagger — leaning away', 'recovery — returning toward upright'],
  die: ['first hit — flinching, eyes closed', 'buckling — knees giving way', 'falling — body tilting', 'on ground — collapsed, motionless'],
  // Objects (main body stays static, only specified dynamic elements change)
  open: ['closed — initial state, fully shut', 'crack — first gap appears, hint of contents', 'half-open — lid/door at midpoint, contents partially visible', 'wide-open — fully open, contents revealed', 'settle — slight bounce back from open', 'final resting — fully open and still'],
  close: ['open — starting from fully open', 'beginning to close — lid/door starts moving', 'half-closed — midpoint', 'nearly shut — small gap remaining', 'click — fully closed'],
  shine: ['sparkle positions A — scattered glints', 'sparkle positions B — shifted glints, brighter core', 'sparkle positions C — peak brightness', 'sparkle positions D — dimming, new positions (loops into frame 0)'],
  activate: ['idle state — mechanism at rest', 'trigger — initial movement begins', 'mid-action — mechanism in motion', 'engaged — mechanism reaches final position'],
  // Effects (colour palette & bounding box stay consistent, particle detail varies)
  burn: ['flame tongues leaning left, bright core', 'flame tongues leaning right, wider spread', 'tall narrow flame, intense core', 'broad low flame, embers rising', 'medium flame, sparks scattering', 'return toward frame 0 shape (loops)'],
  explode: ['origin point — tiny bright core', 'first expansion — ring of debris outward', 'peak — maximum radius, bright flash', 'dissipating — fading edges, smoke wisps', 'remnants — scattered particles, dim glow'],
  magic: ['rune/circle at rest — base pattern visible', 'rotation phase A — 90° turn, glow intensifying', 'rotation phase B — 180°, peak brightness', 'rotation phase C — 270°, glow fading', 'return to base orientation (loops)'],
  heal: ['first particles rising from below', 'more particles, green/gold glow spreading upward', 'peak — dense particle cloud, brightest glow', 'particles fading, glow dimming (loops into frame 0)'],
  hit: ['impact flash — bright star at centre', 'spark burst — radiating lines outward', 'dissipating — sparks fading, lines shortening'],
};

/**
 * Heuristic pose intent for one frame, from the animation name + index.
 * @returns {string}
 */
export function poseFor(animName, idx, total) {
  const base = (animName.split('_')[0] || '').toLowerCase();
  const cycle = POSE_CYCLES[base];
  const dir = facing(animName);
  const dirPart = dir ? `, ${dir}` : '';
  if (cycle) return `${cycle[idx % cycle.length]}${dirPart}`;
  return `frame ${idx + 1} of ${total} for "${animName}"${dirPart}`;
}

/** Look up a moveset/state for an animation in the spec. */
function findMove(spec, animName) {
  const move = (spec.movesets || []).find((m) => m.name === animName);
  const state = spec.states?.definitions?.[animName];
  return {
    frames: move?.frames ?? (state ? undefined : 1),
    fps: move?.fps,
    onEnd: state?.onEnd ?? move?.onEnd ?? 'loop',
    sourcePose: state?.sourcePose ?? move?.sourcePose,
  };
}

/** A compact REFERENCE IMAGES block (priority order, ~3 images). */
function referenceBlock(refPaths = {}) {
  const lines = [];
  if (refPaths.tpose) lines.push(`  1. T-Pose / identity anchor: ${refPaths.tpose}`);
  if (refPaths.input) lines.push(`  • Original reference: ${refPaths.input}`);
  if (refPaths.first) lines.push(`  2. First frame of this animation (locks size/palette): ${refPaths.first}`);
  if (refPaths.prev) lines.push(`  3. Previous frame (motion continuity): ${refPaths.prev}`);
  if (!lines.length) return '';
  return `\nREFERENCE IMAGES (condition on these, in priority order — keep it to ~3):\n${lines.join('\n')}\n`;
}

/**
 * Build the prompt to regenerate ONE frame. This is what the Regenerate button copies.
 * @param {string} templateText  prompts/generation-agent.md contents
 * @param {object} spec          character spec.json
 * @param {string} animName
 * @param {number} frameIdx      0-based
 * @param {number} total         total frames in the animation
 * @param {{tpose?:string,input?:string,first?:string,prev?:string,frameSize?:number[]}} refPaths
 * @returns {string}
 */
export function buildFramePrompt(templateText, spec, animName, frameIdx, total, refPaths = {}) {
  const move = findMove(spec, animName);
  const frameName = `${animName}_${String(frameIdx).padStart(2, '0')}`;
  const onEnd = move.onEnd;
  const loopHint = onEnd === 'loop'
    ? 'This animation LOOPS — the last frame must lead cleanly back into frame 0.'
    : onEnd === 'hold'
      ? 'This animation HOLDS — the last frame is a stable resting pose.'
      : `This animation RETURNS to "${onEnd}" — the last frame should settle toward that pose.`;
  const neighbour = frameIdx === 0
    ? 'First frame of the animation — establishes size, framing and palette.'
    : `Continue smoothly from the previous frame (${animName}_${String(frameIdx - 1).padStart(2, '0')}).`;

  const filled = fillTemplate(templateText, {
    frame_name: frameName,
    animation_name: animName,
    pose_description: poseFor(animName, frameIdx, total),
    neighbor_context: neighbour,
  });

  const size = refPaths.frameSize || spec.frame_size || [256, 256];
  const header = `# Regenerate frame ${frameName} (frame ${frameIdx + 1} of ${total})\n`
    + `Character: ${spec.character_id || 'character'} · Output: ${size[0]}×${size[1]} PNG · ${loopHint}\n`;

  return `${header}${referenceBlock(refPaths)}\n${filled}`.trim();
}

/**
 * Build an overview prompt for a whole animation (the Animation Prompt panel).
 * @returns {string}
 */
export function buildAnimPrompt(templateText, spec, animName, refPaths = {}) {
  const move = findMove(spec, animName);
  const total = move.frames || (spec.states?.definitions?.[animName] ? 4 : 1);
  const dir = facing(animName);
  const lines = [];
  for (let i = 0; i < total; i++) lines.push(`  ${String(i).padStart(2, '0')}: ${poseFor(animName, i, total)}`);

  const header = `# Generate animation "${animName}" for ${spec.character_id || 'character'}\n`
    + `${total} frames${move.fps ? ` @ ${move.fps}fps` : ''} · onEnd: ${move.onEnd}${dir ? ` · ${dir}` : ''}\n`
    + `Generate each frame as a separate file ${animName}_NN.png. Every frame is freshly drawn — never shift/blend a previous frame.\n`;

  const outline = `\nFRAME OUTLINE:\n${lines.join('\n')}\n`;

  // Include the shared rules from the template (background, no-crop, reference budget).
  const rules = fillTemplate(templateText, {
    frame_name: `${animName}_NN`,
    animation_name: animName,
    pose_description: '(see frame outline above)',
    neighbor_context: 'Each frame continues from the previous; the first frame sets size & palette.',
  });

  return `${header}${referenceBlock(refPaths)}${outline}\n${rules}`.trim();
}
