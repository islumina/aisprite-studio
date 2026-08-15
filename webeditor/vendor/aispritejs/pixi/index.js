import { createSpriteAnimator } from '../chunk-EI4PHVNN.js';

// src/pixi/animator.ts
var MissingTextureError = class extends Error {
  keys;
  constructor(keys) {
    super(`aispritejs/pixi: no texture for frame key(s): ${keys.join(", ")}`);
    this.name = "MissingTextureError";
    this.keys = keys;
  }
};
function toTextureMap(src) {
  const maybe = src;
  if (maybe.textures && typeof maybe.textures === "object") {
    return maybe.textures;
  }
  return src;
}
function createPixiSpriteAnimator(sprite, graph, textures, options) {
  const map = toTextureMap(textures);
  const applyAnchor = options?.applyAnchor !== false;
  const playable = sprite;
  if (typeof playable.stop === "function") playable.stop();
  const missing = /* @__PURE__ */ new Set();
  for (const frameKeys of Object.values(graph.animations)) {
    for (const key of frameKeys) {
      if (!Object.hasOwn(map, key)) missing.add(key);
    }
  }
  if (missing.size > 0) throw new MissingTextureError([...missing]);
  const core = createSpriteAnimator(graph);
  let boundKey = "";
  function sync() {
    const key = core.activeFrameKey;
    if (key === boundKey) return;
    boundKey = key;
    const tex = map[key];
    sprite.texture = tex;
    if (applyAnchor && tex.defaultAnchor) {
      sprite.anchor.set(tex.defaultAnchor.x, tex.defaultAnchor.y);
    }
  }
  sync();
  return {
    sprite,
    update(deltaMs) {
      core.update(deltaMs);
      sync();
    },
    setInput(name, value) {
      core.setInput(name, value);
    },
    fireTrigger(name) {
      core.fireTrigger(name);
    },
    reset() {
      core.reset();
      sync();
    },
    dispose() {
      core.dispose();
    },
    get activeState() {
      return core.activeState;
    },
    get activeFrameKey() {
      return core.activeFrameKey;
    },
    get disposed() {
      return core.disposed;
    },
    onComplete(handler, options2) {
      return core.onComplete(handler, options2);
    },
    onStateChange(handler, options2) {
      return core.onStateChange(handler, options2);
    }
  };
}

export { MissingTextureError, createPixiSpriteAnimator };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map