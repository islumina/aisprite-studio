import { isObject, createSpriteAnimator } from '../chunk-EI4PHVNN.js';

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
    for (const [key, entry] of Object.entries(frames)) {
      if (!isObject(entry)) {
        const actualType = entry === null ? "null" : Array.isArray(entry) ? "array" : typeof entry;
        throw new InvalidAtlasError(`frame entry "${key}" must be an object, got ${actualType}`);
      }
    }
  }
  let resolved;
  if (control) {
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
    for (const [key, val] of Object.entries(atlas.inputs)) {
      if (!isObject(val)) {
        const actualType = val === null ? "null" : Array.isArray(val) ? "array" : typeof val;
        throw new InvalidAtlasError(`input entry "${key}" must be an object, got ${actualType}`);
      }
    }
    for (const [key, val] of Object.entries(atlas.states)) {
      if (!isObject(val)) {
        const actualType = val === null ? "null" : Array.isArray(val) ? "array" : typeof val;
        throw new InvalidAtlasError(`state entry "${key}" must be an object, got ${actualType}`);
      }
    }
    const rawTransitions = atlas.transitions;
    for (let i = 0; i < rawTransitions.length; i++) {
      const entry = rawTransitions[i];
      if (!isObject(entry)) {
        const actualType = entry === null ? "null" : Array.isArray(entry) ? "array" : typeof entry;
        throw new InvalidAtlasError(`transitions[${i}] must be an object, got ${actualType}`);
      }
      if (Array.isArray(entry.when)) {
        const rawWhen = entry.when;
        for (let j = 0; j < rawWhen.length; j++) {
          const cond = rawWhen[j];
          if (!isObject(cond)) {
            const actualType = cond === null ? "null" : Array.isArray(cond) ? "array" : typeof cond;
            throw new InvalidAtlasError(
              `transitions[${i}].when[${j}] must be an object, got ${actualType}`
            );
          }
        }
      }
    }
    resolved = {
      inputs: atlas.inputs,
      states: atlas.states,
      transitions: rawTransitions,
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