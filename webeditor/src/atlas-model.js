// AI Sprite Studio — atlas data model
//
// Pure-ish helpers over the atlas.json object: normalisation, name-driven loop
// defaults, the playback resolver the preview consumes, and small mutators that
// announce changes on the bus. No PixiJS, no DOM — this is the single source of
// truth for "what should play, how, and for how long".
import { bus, EV } from './bus.js';
import { DEFAULT_ANCHOR, DEFAULT_FRAME_DURATION_MS, DEFAULT_SOURCE_SIZE } from './constants.js';

// --- Name-convention loop defaults -----------------------------------------
// "依名稱讓工具調整": an animation's name implies its end behaviour. A flame loops,
// a chest opens once and stays open, an attack plays once then returns to idle.
const LOOP_NAME_RE = /(idle|loop|burn|fire|flame|spin|wave|float|hover|breath|blink|pulse|glow)/i;
const ONCE_NAME_RE = /(open|close|hit|hurt|attack|cast|die|death|dead|spawn|explode|break|pop|once|appear|vanish)/i;

/**
 * Infer a default `onEnd` from an animation/state name.
 * @param {string} name
 * @returns {'loop'|'hold'} 'loop' = repeat forever, 'hold' = freeze on the last frame.
 */
export function inferOnEnd(name) {
  if (ONCE_NAME_RE.test(name)) return 'hold';
  if (LOOP_NAME_RE.test(name)) return 'loop';
  return 'loop'; // safe default for ambient sprites; the editor lets the artist override.
}

// --- Normalisation ----------------------------------------------------------
/**
 * Whether the atlas declares an aispritejs control block (`inputs` / `states` /
 * `transitions`). Such an atlas is parsed strictly by aispritejs; one without
 * any of the three plays its animations directly.
 * @param {any} atlas
 * @returns {boolean}
 */
export function hasControlBlock(atlas) {
  return atlas?.inputs !== undefined || atlas?.states !== undefined || atlas?.transitions !== undefined;
}

/**
 * Backfill optional fields so the rest of the editor can assume they exist.
 * @param {any} atlas
 * @returns {any} the same object, mutated in place and returned for chaining.
 */
export function normaliseAtlas(atlas) {
  if (!atlas || typeof atlas !== 'object') throw new Error('atlas must be an object');
  if (atlas.assetType !== 'object') atlas.assetType = atlas.assetType || 'character';
  atlas.poses = atlas.poses || {};
  atlas.animations = atlas.animations || {};
  atlas.frames = atlas.frames || {};
  atlas.animationConfig = atlas.animationConfig || {};

  // Ensure every animation has a playback config (objects rely on it; characters
  // mirror it from their state for a single source of truth).
  for (const animName of Object.keys(atlas.animations)) {
    const cfg = atlas.animationConfig[animName] || {};
    if (cfg.loop === undefined && cfg.onEnd === undefined) cfg.onEnd = inferOnEnd(animName);
    if (cfg.onEnd === undefined) cfg.onEnd = cfg.loop === false ? 'hold' : 'loop';
    atlas.animationConfig[animName] = cfg;
  }
  return atlas;
}

// --- Playable units ---------------------------------------------------------
/**
 * @typedef {Object} Unit
 * @property {string} name        Display + selection key.
 * @property {string} animation   Key into atlas.animations.
 * @property {string} onEnd       'loop' | 'hold' | a state name to jump to.
 * @property {string|undefined} sourcePose  Originating T-Pose id, if any.
 * @property {'state'|'animation'} kind
 */

/**
 * Enumerate everything the artist can preview: the states of an aispritejs
 * graph, or the animations of an atlas without one (objects, effects).
 * @param {any} atlas
 * @returns {Unit[]}
 */
export function getUnits(atlas) {
  if (hasControlBlock(atlas)) {
    return Object.entries(atlas.states ?? {})
      .filter(([, def]) => def !== null && typeof def === 'object' && !Array.isArray(def))
      .map(([name, def]) => ({
        name,
        animation: def.animation,
        // aispritejs defaults `loop` to false when it is omitted.
        onEnd: def.loop === true ? 'loop' : (def.onEnd ?? 'hold'),
        sourcePose: undefined,
        kind: 'state',
      }));
  }
  return Object.keys(atlas.animations ?? {}).map((name) => {
    const cfg = atlas.animationConfig?.[name] || {};
    return {
      name,
      animation: name,
      onEnd: cfg.onEnd ?? 'loop',
      sourcePose: cfg.sourcePose,
      kind: 'animation',
    };
  });
}

/**
 * The unit playback starts in: the graph's `initial` state, else the first unit
 * (aispritejs also defaults to the first declared state).
 * @param {any} atlas
 * @returns {string|null}
 */
export function initialUnit(atlas) {
  const units = getUnits(atlas);
  const initial = hasControlBlock(atlas) ? atlas.initial : undefined;
  return units.find((unit) => unit.name === initial)?.name ?? units[0]?.name ?? null;
}

/**
 * Resolve a unit into everything the preview needs to render one playthrough.
 * @param {any} atlas
 * @param {string} unitName
 * @returns {{ frames: string[], onEnd: string, loop: boolean, durationMs: number, anchor: {x:number,y:number} } | null}
 */
export function resolvePlayback(atlas, unitName) {
  const unit = getUnits(atlas).find((u) => u.name === unitName);
  if (!unit) return null;
  const frameKeys = atlas.animations[unit.animation] || [];
  if (frameKeys.length === 0) return null;

  const first = atlas.frames[frameKeys[0]] || {};
  const cfg = atlas.animationConfig[unit.animation] || {};
  // aispritejs applies state.speed at playback; these values are for the UI,
  // which shows the time a frame is on screen.
  const speed = (unit.kind === 'state' && atlas.states[unitName]?.speed) || 1;
  const frameFallback = atlas.defaultFrameDuration || DEFAULT_FRAME_DURATION_MS; // as runtime.js gives the animator
  const rawDurationMs = cfg.fps ? Math.round(1000 / cfg.fps) : (first.duration || frameFallback);
  const durationMs = Math.max(1, Math.round(rawDurationMs / speed));

  return {
    animation: unit.animation,
    frames: frameKeys,
    onEnd: unit.onEnd ?? 'loop',
    loop: (unit.onEnd ?? 'loop') === 'loop',
    durationMs,
    frameDurations: frameKeys.map((fk) => Math.max(1, Math.round(
      (atlas.frames[fk]?.duration || frameFallback) / speed,
    ))),
    anchor: first.anchor || { ...DEFAULT_ANCHOR },
    sourceSize: first.sourceSize || { ...DEFAULT_SOURCE_SIZE },
  };
}

// --- Mutators (announce on the bus so the preview reflects instantly) --------

/** Set a unit's end behaviour ('loop' | 'hold' | '<stateName>') and republish. */
export function setOnEnd(atlas, unitName, onEnd) {
  if (hasControlBlock(atlas) && atlas.states?.[unitName]) {
    const state = atlas.states[unitName];
    state.loop = onEnd === 'loop';
    if (onEnd === 'loop' || onEnd === 'hold') delete state.onEnd;
    else state.onEnd = onEnd;
  } else {
    const cfg = (atlas.animationConfig[unitName] = atlas.animationConfig[unitName] || {});
    cfg.onEnd = onEnd;
    cfg.loop = onEnd === 'loop';
  }
  bus.emit(EV.ATLAS_CHANGED, { reason: `onEnd:${unitName}` });
}

/** Set the per-frame duration (ms) for every frame in a unit's animation. */
export function setDuration(atlas, unitName, durationMs) {
  const unit = getUnits(atlas).find((u) => u.name === unitName);
  if (!unit) return;
  const speed = (unit.kind === 'state' && atlas.states[unitName]?.speed) || 1;
  const storedDuration = Math.max(1, Math.round(durationMs * speed));
  for (const fk of atlas.animations[unit.animation] || []) {
    if (atlas.frames[fk]) atlas.frames[fk].duration = storedDuration;
  }
  bus.emit(EV.ATLAS_CHANGED, { reason: `duration:${unitName}` });
}

/** Set one frame's stored duration (ms), as edited in the timeline. */
export function setFrameDuration(atlas, frameKey, durationMs) {
  const frame = atlas.frames?.[frameKey];
  if (!frame) return;
  frame.duration = Math.max(1, Math.round(durationMs));
  bus.emit(EV.ATLAS_CHANGED, { reason: `frame-duration:${frameKey}` });
}

/**
 * Summarise the per-frame durations that actually play, for the Frame Duration control.
 * @param {number[]} frameDurations  `resolvePlayback(...).frameDurations`.
 * @returns {{ ms: number, uniform: boolean }} Rounded mean, and whether every frame matches it.
 */
export function summariseFrameDurations(frameDurations) {
  if (!frameDurations?.length) return { ms: 0, uniform: true };
  const total = frameDurations.reduce((sum, ms) => sum + ms, 0);
  return {
    ms: Math.round(total / frameDurations.length),
    uniform: frameDurations.every((ms) => ms === frameDurations[0]),
  };
}

/** Update the anchor for all frames in a unit's animation. */
export function setAnchor(atlas, unitName, anchor) {
  const unit = getUnits(atlas).find((u) => u.name === unitName);
  if (!unit) return;
  for (const fk of atlas.animations[unit.animation] || []) {
    if (atlas.frames[fk]) atlas.frames[fk].anchor = { ...anchor };
  }
  bus.emit(EV.ATLAS_CHANGED, { reason: `anchor:${unitName}` });
}

/** Update the anchor for all frames in the entire atlas. */
export function setAnchorAll(atlas, anchor) {
  if (atlas.frames) {
    for (const fk of Object.keys(atlas.frames)) {
      if (atlas.frames[fk]) atlas.frames[fk].anchor = { ...anchor };
    }
  }
  bus.emit(EV.ATLAS_CHANGED, { reason: 'anchor:all' });
}
