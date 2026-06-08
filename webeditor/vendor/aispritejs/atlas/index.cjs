'use strict';

// src/sprite/errors.ts
var SpriteAnimatorDisposedError = class extends Error {
  constructor() {
    super("aispritejs: animator has been disposed; this operation is not allowed");
    this.name = "SpriteAnimatorDisposedError";
  }
};
var InvalidGraphError = class extends Error {
  constructor(message) {
    super(`aispritejs: invalid graph \u2014 ${message}`);
    this.name = "InvalidGraphError";
  }
};
var UnknownInputError = class extends Error {
  input;
  constructor(input) {
    super(`aispritejs: unknown input "${input}"; declare it in the graph's inputs block`);
    this.name = "UnknownInputError";
    this.input = input;
  }
};
var InputTypeError = class extends Error {
  input;
  constructor(input, message) {
    super(`aispritejs: input "${input}" \u2014 ${message}`);
    this.name = "InputTypeError";
    this.input = input;
  }
};

// src/sprite/compile.ts
var DEFAULT_FRAME_DURATION = 100;
function compileGraph(graph) {
  const stateEntries = Object.entries(graph.states);
  if (stateEntries.length === 0) {
    throw new InvalidGraphError("states must declare at least one state");
  }
  for (const [name, def] of Object.entries(graph.inputs)) {
    if (def.type !== "number" && def.type !== "boolean" && def.type !== "trigger") {
      throw new InvalidGraphError(
        `input "${name}" has unknown type "${def.type}"`
      );
    }
  }
  const defaultDuration = graph.defaultFrameDuration ?? DEFAULT_FRAME_DURATION;
  if (!(defaultDuration > 0)) {
    throw new InvalidGraphError(`defaultFrameDuration must be > 0, got ${defaultDuration}`);
  }
  if (graph.frames) {
    for (const [key, timing] of Object.entries(graph.frames)) {
      if (timing.duration !== void 0 && !(timing.duration > 0)) {
        throw new InvalidGraphError(`frame "${key}" duration must be > 0, got ${timing.duration}`);
      }
    }
  }
  const initial = graph.initial ?? stateEntries[0][0];
  if (!(initial in graph.states)) {
    throw new InvalidGraphError(`initial state "${initial}" is not declared`);
  }
  const states = /* @__PURE__ */ new Map();
  for (const [name, st] of stateEntries) {
    const frameKeys = graph.animations[st.animation];
    if (frameKeys === void 0) {
      throw new InvalidGraphError(`state "${name}" references unknown animation "${st.animation}"`);
    }
    if (frameKeys.length === 0) {
      throw new InvalidGraphError(`animation "${st.animation}" (state "${name}") has no frames`);
    }
    const speed = st.speed ?? 1;
    if (!(speed > 0)) {
      throw new InvalidGraphError(`state "${name}" speed must be > 0, got ${speed}`);
    }
    const loop = st.loop === true;
    if (loop && st.onEnd !== void 0) {
      throw new InvalidGraphError(
        `state "${name}" loops, so onEnd "${st.onEnd}" would never fire; set loop:false or drop onEnd`
      );
    }
    if (st.onEnd !== void 0 && !(st.onEnd in graph.states)) {
      throw new InvalidGraphError(`state "${name}" onEnd target "${st.onEnd}" is not declared`);
    }
    const cumulative = [];
    let running = 0;
    for (const key of frameKeys) {
      running += graph.frames?.[key]?.duration ?? defaultDuration;
      cumulative.push(running);
    }
    states.set(name, {
      name,
      animation: st.animation,
      loop,
      speed,
      onEnd: st.onEnd,
      frameKeys,
      cumulative,
      total: running
    });
  }
  const compiled = [];
  graph.transitions.forEach((t, order) => {
    if (t.from !== "*" && !(t.from in graph.states)) {
      throw new InvalidGraphError(`transition #${order} from "${t.from}" is not a declared state`);
    }
    if (!(t.to in graph.states)) {
      throw new InvalidGraphError(`transition #${order} to "${t.to}" is not a declared state`);
    }
    const conditions = [];
    const triggers = [];
    for (const c of t.when ?? []) {
      const def = graph.inputs[c.input];
      if (def === void 0) {
        throw new InvalidGraphError(
          `transition #${order} condition references unknown input "${c.input}"`
        );
      }
      compileCondition(order, c.input, c.op, c.value, def.type, conditions, triggers);
    }
    compiled.push({
      from: t.from,
      to: t.to,
      priority: t.priority ?? 0,
      order,
      conditions,
      triggers
    });
  });
  const candidatesByState = /* @__PURE__ */ new Map();
  for (const [name] of stateEntries) {
    const list = compiled.filter((t) => t.from === name || t.from === "*");
    list.sort((a, b) => b.priority - a.priority || a.order - b.order);
    candidatesByState.set(name, list);
  }
  return { initial, states, candidatesByState };
}
function compileCondition(order, input, op, value, kind, out, triggers) {
  switch (op) {
    case "Trigger": {
      if (kind !== "trigger") {
        throw new InvalidGraphError(
          `transition #${order}: op Trigger requires a trigger input, but "${input}" is ${kind}`
        );
      }
      if (value !== void 0) {
        throw new InvalidGraphError(
          `transition #${order}: Trigger condition on "${input}" must not carry a value`
        );
      }
      out.push((s) => s.isPending(input));
      triggers.push(input);
      return;
    }
    case "GreaterThan":
    case "LessThan": {
      if (kind !== "number") {
        throw new InvalidGraphError(
          `transition #${order}: op ${op} requires a number input, but "${input}" is ${kind}`
        );
      }
      if (typeof value !== "number") {
        throw new InvalidGraphError(
          `transition #${order}: op ${op} on "${input}" needs a numeric value`
        );
      }
      const v = value;
      out.push(
        op === "GreaterThan" ? (s) => s.readNumber(input) > v : (s) => s.readNumber(input) < v
      );
      return;
    }
    case "Equals":
    case "NotEquals": {
      if (kind === "trigger") {
        throw new InvalidGraphError(
          `transition #${order}: op ${op} cannot apply to trigger input "${input}"`
        );
      }
      if (kind === "number") {
        if (typeof value !== "number") {
          throw new InvalidGraphError(
            `transition #${order}: op ${op} on number input "${input}" needs a numeric value`
          );
        }
        const v2 = value;
        out.push(
          op === "Equals" ? (s) => s.readNumber(input) === v2 : (s) => s.readNumber(input) !== v2
        );
        return;
      }
      if (typeof value !== "boolean") {
        throw new InvalidGraphError(
          `transition #${order}: op ${op} on boolean input "${input}" needs a boolean value`
        );
      }
      const v = value;
      out.push(
        op === "Equals" ? (s) => s.readBoolean(input) === v : (s) => s.readBoolean(input) !== v
      );
      return;
    }
    default:
      throw new InvalidGraphError(`transition #${order}: unknown operator "${op}"`);
  }
}

// src/sprite/emitter.ts
function createSignal() {
  const listeners = /* @__PURE__ */ new Set();
  function on(handler, options) {
    if (options?.signal?.aborted) return () => {
    };
    let detachAbort;
    const cleanup = () => {
      listeners.delete(wrapped);
      if (detachAbort) {
        detachAbort();
        detachAbort = void 0;
      }
    };
    let wrapped = handler;
    if (options?.once) {
      wrapped = (payload) => {
        cleanup();
        handler(payload);
      };
    }
    listeners.add(wrapped);
    const sig = options?.signal;
    if (sig) {
      const onAbort = () => cleanup();
      sig.addEventListener("abort", onAbort, { once: true });
      detachAbort = () => sig.removeEventListener("abort", onAbort);
    }
    return cleanup;
  }
  function emit(payload) {
    if (listeners.size === 0) return;
    for (const fn of [...listeners]) fn(payload);
  }
  function clear() {
    listeners.clear();
  }
  return { on, emit, clear };
}

// src/sprite/inputs.ts
function createInputStore(inputs) {
  const kinds = /* @__PURE__ */ new Map();
  const numberDefaults = /* @__PURE__ */ new Map();
  const booleanDefaults = /* @__PURE__ */ new Map();
  const numbers = /* @__PURE__ */ new Map();
  const booleans = /* @__PURE__ */ new Map();
  const triggers = /* @__PURE__ */ new Map();
  for (const [name, def] of Object.entries(inputs)) {
    kinds.set(name, def.type);
    if (def.type === "number") {
      const d = def.default ?? 0;
      numberDefaults.set(name, d);
      numbers.set(name, d);
    } else if (def.type === "boolean") {
      const d = def.default ?? false;
      booleanDefaults.set(name, d);
      booleans.set(name, d);
    } else {
      triggers.set(name, false);
    }
  }
  function setInput(name, value) {
    const kind = kinds.get(name);
    if (kind === void 0) throw new UnknownInputError(name);
    if (kind === "trigger") {
      throw new InputTypeError(name, "is a Trigger; use fireTrigger()");
    }
    if (kind === "number") {
      if (typeof value !== "number") {
        throw new InputTypeError(name, `expects a number, received ${typeof value}`);
      }
      if (Number.isNaN(value)) {
        throw new InputTypeError(name, "cannot be set to NaN");
      }
      numbers.set(name, value);
      return;
    }
    if (typeof value !== "boolean") {
      throw new InputTypeError(name, `expects a boolean, received ${typeof value}`);
    }
    booleans.set(name, value);
  }
  function fireTrigger(name) {
    const kind = kinds.get(name);
    if (kind === void 0) throw new UnknownInputError(name);
    if (kind !== "trigger") {
      throw new InputTypeError(name, "is not a Trigger; use setInput()");
    }
    triggers.set(name, true);
  }
  return {
    setInput,
    fireTrigger,
    // `!` is sound: every declared input is seeded at construction and the
    // compiler validates that conditions only read declared inputs of the
    // matching kind, so these reads always hit a present entry.
    readNumber: (name) => numbers.get(name),
    readBoolean: (name) => booleans.get(name),
    isPending: (name) => triggers.get(name) === true,
    consume: (name) => {
      triggers.set(name, false);
    },
    reset: () => {
      for (const [name, d] of numberDefaults) numbers.set(name, d);
      for (const [name, d] of booleanDefaults) booleans.set(name, d);
      for (const name of triggers.keys()) triggers.set(name, false);
    }
  };
}

// src/sprite/machine.ts
var NO_TRIGGERS = [];
function createSpriteAnimator(graph) {
  const compiled = compileGraph(graph);
  const store = createInputStore(graph.inputs);
  const stateChange = createSignal();
  const complete = createSignal();
  let current = mustState(compiled.initial);
  let elapsed = 0;
  let completed = false;
  let activeFrameIndex = 0;
  let activeFrameKey = current.frameKeys[0];
  let disposed = false;
  function mustState(name) {
    return compiled.states.get(name);
  }
  function enter(to, consume) {
    const from = current.name;
    for (let i = 0; i < consume.length; i++) {
      store.consume(consume[i]);
    }
    current = mustState(to);
    elapsed = 0;
    completed = false;
    activeFrameIndex = 0;
    activeFrameKey = current.frameKeys[0];
    if (to !== from) stateChange.emit({ to, from });
  }
  function resolve() {
    const list = compiled.candidatesByState.get(current.name);
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      let ok = true;
      const conds = t.conditions;
      for (let j = 0; j < conds.length; j++) {
        if (!conds[j](store)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (t.to === current.name && t.triggers.length === 0) continue;
      return { to: t.to, triggers: t.triggers };
    }
    return void 0;
  }
  function update(deltaMs) {
    if (disposed) throw new SpriteAnimatorDisposedError();
    elapsed += (deltaMs > 0 ? deltaMs : 0) * current.speed;
    const chosen = resolve();
    if (chosen) {
      enter(chosen.to, chosen.triggers);
      return;
    }
    const cs = current;
    const n = cs.frameKeys.length;
    let ended = false;
    if (!cs.loop && elapsed >= cs.total) {
      activeFrameIndex = n - 1;
      ended = true;
    } else {
      const t = cs.loop ? elapsed % cs.total : elapsed;
      let i = 0;
      while (i < n - 1 && t >= cs.cumulative[i]) i++;
      activeFrameIndex = i;
    }
    activeFrameKey = cs.frameKeys[activeFrameIndex];
    if (ended && !completed) {
      completed = true;
      complete.emit(cs.name);
      if (cs.onEnd !== void 0) enter(cs.onEnd, NO_TRIGGERS);
    }
  }
  function reset() {
    if (disposed) throw new SpriteAnimatorDisposedError();
    const from = current.name;
    store.reset();
    current = mustState(compiled.initial);
    elapsed = 0;
    completed = false;
    activeFrameIndex = 0;
    activeFrameKey = current.frameKeys[0];
    if (from !== compiled.initial) stateChange.emit({ to: compiled.initial, from });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    stateChange.clear();
    complete.clear();
  }
  return {
    setInput(name, value) {
      if (disposed) throw new SpriteAnimatorDisposedError();
      store.setInput(name, value);
    },
    fireTrigger(name) {
      if (disposed) throw new SpriteAnimatorDisposedError();
      store.fireTrigger(name);
    },
    update,
    reset,
    dispose,
    onStateChange(handler, options) {
      if (disposed) return () => {
      };
      return stateChange.on((p) => handler(p.to, p.from), options);
    },
    onComplete(handler, options) {
      if (disposed) return () => {
      };
      return complete.on(handler, options);
    },
    get activeState() {
      return current.name;
    },
    get activeFrameKey() {
      return activeFrameKey;
    },
    get activeFrameIndex() {
      return activeFrameIndex;
    },
    get disposed() {
      return disposed;
    }
  };
}

// src/atlas/parse.ts
var InvalidAtlasError = class extends Error {
  constructor(message) {
    super(`aispritejs/atlas: ${message}`);
    this.name = "InvalidAtlasError";
  }
};
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
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

exports.InvalidAtlasError = InvalidAtlasError;
exports.loadAtlas = loadAtlas;
exports.parseAtlas = parseAtlas;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map