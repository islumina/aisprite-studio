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
var MAX_DURATION = 864e5;
var MAX_SPEED = 1e3;
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function assertString(v, what) {
  if (typeof v !== "string") {
    throw new InvalidGraphError(`${what} must be a string, got ${typeof v}`);
  }
}
function assertPositive(v, what, max, unit) {
  if (!Number.isFinite(v) || v <= 0) {
    throw new InvalidGraphError(`${what} must be a finite number > 0, got ${v}`);
  }
  if (v > max) throw new InvalidGraphError(`${what} must be \u2264 ${max}${unit}, got ${v}`);
}
function assertGraphShape(graph) {
  if (!isObject(graph)) throw new InvalidGraphError("graph must be an object");
  for (const key of ["animations", "inputs", "states"]) {
    if (!isObject(graph[key])) throw new InvalidGraphError(`${key} must be an object`);
  }
  if (!Array.isArray(graph.transitions)) {
    throw new InvalidGraphError("transitions must be an array");
  }
  for (const [name, list] of Object.entries(graph.animations)) {
    if (!Array.isArray(list)) {
      throw new InvalidGraphError(`animation "${name}" must be an array of frame keys`);
    }
  }
}
function compileGraph(graph) {
  assertGraphShape(graph);
  if (Object.keys(graph.animations).length === 0) {
    throw new InvalidGraphError("animations must declare at least one animation");
  }
  const stateEntries = Object.entries(graph.states);
  if (stateEntries.length === 0) {
    throw new InvalidGraphError("states must declare at least one state");
  }
  for (const [name, def] of Object.entries(graph.inputs)) {
    const type = def?.type;
    if (type !== "number" && type !== "boolean" && type !== "trigger") {
      throw new InvalidGraphError(`input "${name}" has unknown type "${type}"`);
    }
    const d = def.default;
    if (d !== void 0 && (type === "number" && typeof d !== "number" || type === "boolean" && typeof d !== "boolean")) {
      throw new InvalidGraphError(
        `input "${name}" default must be a ${type} (declared type "${type}"), got ${typeof d}`
      );
    }
  }
  const defaultDuration = graph.defaultFrameDuration ?? DEFAULT_FRAME_DURATION;
  assertPositive(defaultDuration, "defaultFrameDuration", MAX_DURATION, " ms");
  if (graph.frames) {
    for (const [key, timing] of Object.entries(graph.frames)) {
      if (!isObject(timing)) {
        throw new InvalidGraphError(`frame "${key}" timing must be an object`);
      }
      if (timing.duration !== void 0) {
        assertPositive(timing.duration, `frame "${key}" duration`, MAX_DURATION, " ms");
      }
    }
  }
  if (graph.initial !== void 0) assertString(graph.initial, "initial");
  const initial = graph.initial ?? stateEntries[0][0];
  if (!Object.hasOwn(graph.states, initial)) {
    throw new InvalidGraphError(`initial state "${initial}" is not declared`);
  }
  const states = /* @__PURE__ */ new Map();
  for (const [name, st] of stateEntries) {
    assertString(st?.animation, `state "${name}" animation`);
    if (st.onEnd !== void 0) assertString(st.onEnd, `state "${name}" onEnd`);
    const frameKeys = graph.animations[st.animation];
    if (frameKeys === void 0 || !Object.hasOwn(graph.animations, st.animation)) {
      throw new InvalidGraphError(`state "${name}" references unknown animation "${st.animation}"`);
    }
    if (frameKeys.length === 0) {
      throw new InvalidGraphError(`animation "${st.animation}" (state "${name}") has no frames`);
    }
    const speed = st.speed ?? 1;
    assertPositive(speed, `state "${name}" speed`, MAX_SPEED, "");
    const loop = st.loop === true;
    if (loop && st.onEnd !== void 0) {
      throw new InvalidGraphError(
        `state "${name}" loops, so onEnd "${st.onEnd}" would never fire; set loop:false or drop onEnd`
      );
    }
    if (st.onEnd !== void 0 && !Object.hasOwn(graph.states, st.onEnd)) {
      throw new InvalidGraphError(`state "${name}" onEnd target "${st.onEnd}" is not declared`);
    }
    const cumulative = [];
    let running = 0;
    for (const key of frameKeys) {
      running += graph.frames?.[key]?.duration ?? defaultDuration;
      cumulative.push(running);
    }
    states.set(name, { name, loop, speed, onEnd: st.onEnd, frameKeys, cumulative, total: running });
  }
  const compiled = [];
  graph.transitions.forEach((t, order) => {
    if (!isObject(t)) {
      throw new InvalidGraphError(`transition #${order} must be an object`);
    }
    if (t.when !== void 0 && !Array.isArray(t.when)) {
      throw new InvalidGraphError(`transition #${order} "when" must be an array`);
    }
    assertString(t.from, `transition #${order} "from"`);
    assertString(t.to, `transition #${order} "to"`);
    if (t.priority !== void 0 && !Number.isInteger(t.priority)) {
      throw new InvalidGraphError(
        `transition #${order} priority must be an integer, got ${t.priority}`
      );
    }
    if (t.from !== "*" && !Object.hasOwn(graph.states, t.from)) {
      throw new InvalidGraphError(`transition #${order} from "${t.from}" is not a declared state`);
    }
    if (!Object.hasOwn(graph.states, t.to)) {
      throw new InvalidGraphError(`transition #${order} to "${t.to}" is not a declared state`);
    }
    const conditions = [];
    const triggers = [];
    for (const c of t.when ?? []) {
      assertString(
        c?.input,
        `transition #${order} condition "input"`
      );
      assertString(c.op, `transition #${order} condition "op"`);
      const def = graph.inputs[c.input];
      if (def === void 0 || !Object.hasOwn(graph.inputs, c.input)) {
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
  const listeners = /* @__PURE__ */ new Map();
  function on(handler, options) {
    const once = options?.once;
    const sig = options?.signal;
    if (sig?.aborted) return () => {
    };
    let detachAbort;
    const cleanup = () => {
      listeners.delete(wrapped);
      if (detachAbort) {
        detachAbort();
        detachAbort = void 0;
      }
    };
    const wrapped = (payload) => {
      if (once) cleanup();
      handler(payload);
    };
    listeners.set(wrapped, cleanup);
    if (sig) {
      const onAbort = () => cleanup();
      sig.addEventListener("abort", onAbort, { once: true });
      detachAbort = () => sig.removeEventListener("abort", onAbort);
    }
    return cleanup;
  }
  function emit(payload) {
    if (listeners.size === 0) return;
    let failure;
    for (const fn of [...listeners.keys()]) {
      if (!listeners.has(fn)) continue;
      try {
        fn(payload);
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure) throw failure.error;
  }
  function clear() {
    try {
      for (const cleanup of [...listeners.values()]) {
        try {
          cleanup();
        } catch {
        }
      }
    } finally {
      listeners.clear();
    }
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
  let dispatching = false;
  const mailbox = [];
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
      return t;
    }
    return void 0;
  }
  function processUpdate(deltaMs) {
    const next = elapsed + (Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0) * current.speed;
    if (Number.isFinite(next)) elapsed = next;
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
      try {
        complete.emit(cs.name);
      } finally {
        if (cs.onEnd !== void 0 && !disposed) enter(cs.onEnd, NO_TRIGGERS);
      }
    }
  }
  function processReset() {
    store.reset();
    enter(compiled.initial, NO_TRIGGERS);
  }
  function run(first, dt) {
    dispatching = true;
    try {
      first(dt);
      while (mailbox.length > 0) {
        const m = mailbox.shift();
        if (m.kind === "update") processUpdate(m.dt);
        else processReset();
      }
    } finally {
      dispatching = false;
      mailbox.length = 0;
    }
  }
  function update(deltaMs) {
    if (disposed) throw new SpriteAnimatorDisposedError();
    if (dispatching) mailbox.push({ kind: "update", dt: deltaMs });
    else run(processUpdate, deltaMs);
  }
  function reset() {
    if (disposed) throw new SpriteAnimatorDisposedError();
    if (dispatching) mailbox.push({ kind: "reset" });
    else run(processReset, 0);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    mailbox.length = 0;
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

export { InputTypeError, InvalidGraphError, SpriteAnimatorDisposedError, UnknownInputError, assertGraphShape, createSpriteAnimator, isObject };
//# sourceMappingURL=chunk-NBMU2UNJ.js.map
//# sourceMappingURL=chunk-NBMU2UNJ.js.map