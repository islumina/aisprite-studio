import { isObject, createSpriteAnimator } from '../chunk-NBMU2UNJ.js';

// src/atlas/parse.ts
var InvalidAtlasError = class extends Error {
  constructor(message) {
    super(`aispritejs/atlas: ${message}`);
    this.name = "InvalidAtlasError";
  }
};
function isForeignStates(states) {
  return isObject(states) && typeof states.initial === "string" && isObject(states.definitions);
}
function typeName(v) {
  return v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
}
function assertEntry(v, what) {
  if (!isObject(v)) throw new InvalidAtlasError(`${what} must be an object, got ${typeName(v)}`);
}
function assertAnimations(value) {
  if (!isObject(value)) {
    throw new InvalidAtlasError("`animations` must be an object of frame-key lists");
  }
  for (const [name, list] of Object.entries(value)) {
    if (!Array.isArray(list) || list.some((k) => typeof k !== "string")) {
      throw new InvalidAtlasError(`animation "${name}" must be an array of frame-key strings`);
    }
  }
  return value;
}
function assertControlShape(src, p) {
  if (!isObject(src.inputs)) throw new InvalidAtlasError(`${p}inputs must be an object`);
  if (!isObject(src.states)) throw new InvalidAtlasError(`${p}states must be an object`);
  if (!Array.isArray(src.transitions)) {
    throw new InvalidAtlasError(`${p}transitions must be an array`);
  }
  for (const [key, val] of Object.entries(src.inputs)) assertEntry(val, `${p}input entry "${key}"`);
  for (const [key, val] of Object.entries(src.states)) assertEntry(val, `${p}state entry "${key}"`);
  src.transitions.forEach((entry, i) => {
    assertEntry(entry, `${p}transitions[${i}]`);
    const when = entry.when;
    if (Array.isArray(when)) {
      when.forEach((cond, j) => assertEntry(cond, `${p}transitions[${i}].when[${j}]`));
    }
  });
}
function parseAtlas(atlas, control) {
  if (!isObject(atlas)) {
    throw new InvalidAtlasError("atlas must be an object");
  }
  const animations = assertAnimations(atlas.animations);
  const frames = atlas.frames;
  if (frames !== void 0 && !isObject(frames)) {
    throw new InvalidAtlasError("`frames`, if present, must be an object keyed by frame key");
  }
  if (isObject(frames)) {
    for (const [key, entry] of Object.entries(frames)) assertEntry(entry, `frame entry "${key}"`);
  }
  let resolved;
  if (control != null) {
    if (!isObject(control)) throw new InvalidAtlasError("control must be an object");
    assertControlShape(control, "control.");
    if (control.initial !== void 0 && typeof control.initial !== "string") {
      throw new InvalidAtlasError("control.initial must be a string");
    }
    if (control.defaultFrameDuration !== void 0 && typeof control.defaultFrameDuration !== "number") {
      throw new InvalidAtlasError("control.defaultFrameDuration must be a number");
    }
    resolved = control;
  } else {
    if (isForeignStates(atlas.states)) {
      throw new InvalidAtlasError(
        "atlas `states` is event-driven (has `initial`/`definitions`); pass an aispritejs control block as the second argument"
      );
    }
    if (!isObject(atlas.inputs) || !isObject(atlas.states) || !Array.isArray(atlas.transitions)) {
      throw new InvalidAtlasError(
        "atlas has no aispritejs control block (inputs/states/transitions); pass one as the second argument"
      );
    }
    assertControlShape(atlas, "");
    resolved = {
      inputs: atlas.inputs,
      states: atlas.states,
      transitions: atlas.transitions,
      ...typeof atlas.initial === "string" ? { initial: atlas.initial } : {},
      ...typeof atlas.defaultFrameDuration === "number" ? { defaultFrameDuration: atlas.defaultFrameDuration } : {}
    };
  }
  return {
    animations,
    ...frames ? { frames } : {},
    inputs: resolved.inputs,
    states: resolved.states,
    transitions: resolved.transitions,
    ...resolved.initial !== void 0 ? { initial: resolved.initial } : {},
    ...resolved.defaultFrameDuration !== void 0 ? { defaultFrameDuration: resolved.defaultFrameDuration } : {}
  };
}
function loadAtlas(atlas, control) {
  return createSpriteAnimator(parseAtlas(atlas, control));
}

export { InvalidAtlasError, loadAtlas, parseAtlas };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map