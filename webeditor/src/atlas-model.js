// AI Sprite Studio — atlas data model
//
// Pure-ish helpers over the atlas.json object: normalisation, name-driven loop
// defaults, the playback resolver the preview consumes, and small mutators that
// announce changes on the bus. No PixiJS, no DOM — this is the single source of
// truth for "what should play, how, and for how long".
import { bus, EV } from './bus.js';

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
 * Backfill optional fields so the rest of the editor can assume they exist.
 * Backward compatible: legacy atlases (only meta/frames/animations/states) load fine.
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

  // Characters: migrate the legacy `loop` boolean + `next` field onto `onEnd`.
  const defs = atlas.states?.definitions;
  if (defs) {
    for (const [stateName, def] of Object.entries(defs)) {
      if (def.onEnd === undefined) {
        if (def.next) def.onEnd = def.next;            // legacy attack→idle "next"
        else if (def.loop === false) def.onEnd = 'hold';
        else def.onEnd = inferOnEnd(def.animation || stateName);
      }
      def.transitions = def.transitions || {};
    }
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
 * @property {Record<string,{target:string}>} transitions  FSM edges (character mode only).
 * @property {'state'|'animation'} kind
 */

/**
 * Enumerate everything the artist can preview. Character atlases expose FSM
 * states; object/icon atlases expose their animations directly.
 * @param {any} atlas
 * @returns {Unit[]}
 */
export function getUnits(atlas) {
  const defs = atlas.states?.definitions;
  if (atlas.assetType === 'character' && defs) {
    return Object.entries(defs).map(([name, d]) => ({
      name,
      animation: d.animation,
      onEnd: d.onEnd,
      sourcePose: d.sourcePose,
      transitions: d.transitions || {},
      kind: 'state',
    }));
  }
  if (atlas.states && !defs) {
    return Object.entries(atlas.states).map(([name, def]) => ({
      name,
      animation: def.animation,
      // aispritejs defaults `loop` to false when it is omitted.
      onEnd: def.loop === true ? 'loop' : (def.onEnd ?? 'hold'),
      sourcePose: undefined,
      transitions: {},
      kind: 'state',
    }));
  }
  return Object.keys(atlas.animations).map((name) => {
    const cfg = atlas.animationConfig[name] || {};
    return {
      name,
      animation: name,
      onEnd: cfg.onEnd ?? 'loop',
      sourcePose: cfg.sourcePose,
      transitions: {},
      kind: 'animation',
    };
  });
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
  const stateDur = atlas.states?.definitions?.[unitName]?.duration;
  const spriteState = !atlas.states?.definitions ? atlas.states?.[unitName] : undefined;
  const speed = spriteState?.speed ?? 1;
  const rawDurationMs = stateDur
    ? stateDur
    : (cfg.fps ? Math.round(1000 / (cfg.fps || 8)) : (first.duration || atlas.defaultFrameDuration || 125));
  const durationMs = Math.max(1, Math.round(rawDurationMs / speed));

  return {
    animation: unit.animation,
    frames: frameKeys,
    onEnd: unit.onEnd ?? 'loop',
    loop: (unit.onEnd ?? 'loop') === 'loop',
    durationMs,
    frameDurations: frameKeys.map((fk) => Math.max(1, Math.round(
      (atlas.frames[fk]?.duration || rawDurationMs) / speed,
    ))),
    anchor: first.anchor || { x: 0.5, y: 0.5 },
    sourceSize: first.sourceSize || { w: 256, h: 256 },
  };
}

// --- Mutators (announce on the bus so the preview reflects instantly) --------

/** Set a unit's end behaviour ('loop' | 'hold' | '<stateName>') and republish. */
export function setOnEnd(atlas, unitName, onEnd) {
  const def = atlas.states?.definitions?.[unitName];
  if (def) {
    def.onEnd = onEnd;
    def.loop = onEnd === 'loop'; // keep the legacy boolean coherent for PixiJS consumers
  } else if (atlas.states?.[unitName]) {
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
  const spriteState = !atlas.states?.definitions ? atlas.states?.[unitName] : undefined;
  const storedDuration = Math.max(1, Math.round(durationMs * (spriteState?.speed ?? 1)));
  for (const fk of atlas.animations[unit.animation] || []) {
    if (atlas.frames[fk]) atlas.frames[fk].duration = storedDuration;
  }
  const def = atlas.states?.definitions?.[unitName];
  if (def) def.duration = durationMs;
  bus.emit(EV.ATLAS_CHANGED, { reason: `duration:${unitName}` });
}

/** Flip a T-Pose's `enabled` flag (artist opt-in) and republish. */
export function setPoseEnabled(atlas, poseId, enabled) {
  if (atlas.poses?.[poseId]) {
    atlas.poses[poseId].enabled = enabled;
    bus.emit(EV.POSE_TOGGLE, { id: poseId, enabled });
    bus.emit(EV.ATLAS_CHANGED, { reason: `pose:${poseId}` });
  }
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
