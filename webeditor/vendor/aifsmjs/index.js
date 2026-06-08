// src/fsm/types.ts
var RESET_EVENT_TYPE = "@@aifsmjs/RESET";

// src/fsm/evaluator.ts
var UnknownGuardError = class extends Error {
  guardName;
  constructor(guardName) {
    super(`aifsmjs: guard "${guardName}" not found in implementations.guards`);
    this.name = "UnknownGuardError";
    this.guardName = guardName;
  }
};
var AsyncGuardError = class extends Error {
  guardName;
  constructor(guardName) {
    super(
      `aifsmjs: guard "${guardName}" must be sync; received a Promise. Async guards break determinism and replay. Move I/O into an effect.`
    );
    this.name = "AsyncGuardError";
    this.guardName = guardName;
  }
};
function isAsyncGuardFn(fn) {
  if (typeof fn !== "function") return false;
  return fn.constructor?.name === "AsyncFunction";
}
function isThenable(x) {
  return x !== null && (typeof x === "object" || typeof x === "function") && typeof x.then === "function";
}
function resolveGuard(ref, impl) {
  if (typeof ref === "function") return ref;
  const fn = impl.guards?.[ref];
  if (!fn) throw new UnknownGuardError(ref);
  return fn;
}
function evalGuard(ref, context, event, impl, value) {
  const fn = resolveGuard(ref, impl);
  const guardName = typeof ref === "string" ? ref : fn.name || "<inline>";
  if (isAsyncGuardFn(fn)) {
    throw new AsyncGuardError(guardName);
  }
  const args = { context, event };
  const guardsMap = impl.guards;
  if (guardsMap) args.guards = guardsMap;
  if (value !== void 0) args.value = value;
  const result = fn(args);
  if (isThenable(result)) {
    throw new AsyncGuardError(guardName);
  }
  return result;
}

// src/effects/enqueuer.ts
function createEnqueuer(sink) {
  return Object.freeze({
    effect(type, payload) {
      if (payload === void 0) {
        sink.push(Object.freeze({ type }));
      } else {
        sink.push(Object.freeze({ type, payload }));
      }
    }
  });
}

// src/fsm/snapshot.ts
var IS_DEV = typeof process !== "undefined" && typeof process.env !== "undefined" && process.env.NODE_ENV !== "production";
function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
  }
  return value;
}
function freezeSnapshot(snap) {
  return IS_DEV ? deepFreeze(snap) : Object.freeze(snap);
}
function createSnapshot(args) {
  return freezeSnapshot({
    value: args.value,
    context: args.context,
    status: args.status ?? "active"
  });
}

// src/fsm/updater.ts
function isPlainRecord(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function assign(updater) {
  return ({ context, event }) => updater({ context, event });
}
function mergeContext(current, patch) {
  if (patch === void 0 || patch === null) return current;
  if (isPlainRecord(current) && isPlainRecord(patch)) {
    return { ...current, ...patch };
  }
  return patch;
}

// src/fsm/lifecycle.ts
var UnknownActionError = class extends Error {
  actionName;
  constructor(actionName) {
    super(`aifsmjs: action "${actionName}" not found in implementations.actions`);
    this.name = "UnknownActionError";
    this.actionName = actionName;
  }
};
function resolveAction(ref, impl) {
  if (typeof ref === "function") return ref;
  const fn = impl.actions?.[ref];
  if (!fn) throw new UnknownActionError(ref);
  return fn;
}
function runActions(refs, ctx, event, impl, effectSink) {
  if (!refs || refs.length === 0) return ctx;
  const enqueue = createEnqueuer(effectSink);
  let current = ctx;
  for (const ref of refs) {
    const fn = resolveAction(ref, impl);
    const patch = fn({ context: current, event, enqueue });
    current = mergeContext(current, patch);
  }
  return current;
}
function pickTransition(candidates, ctx, event, impl, value) {
  for (const t of candidates) {
    if (!t.guard) return t;
    if (evalGuard(t.guard, ctx, event, impl, value)) return t;
  }
  return void 0;
}
function step(def, snapshot, event, impl) {
  if (snapshot.status === "final") {
    return Object.freeze({ snapshot, effects: [], changed: false });
  }
  const state = def.states[snapshot.value];
  if (!state) {
    return Object.freeze({ snapshot, effects: [], changed: false });
  }
  const candidates = state.on?.[event.type];
  const candidateList = candidates ? Array.isArray(candidates) ? candidates : [candidates] : [];
  const chosen = pickTransition(candidateList, snapshot.context, event, impl, snapshot.value);
  if (!chosen) {
    return Object.freeze({ snapshot, effects: [], changed: false });
  }
  const isExternal = chosen.target !== void 0;
  const nextStateValue = chosen.target ?? snapshot.value;
  const nextState = def.states[nextStateValue];
  const effectSink = [];
  let ctx = snapshot.context;
  if (isExternal) {
    ctx = runActions(state.exit, ctx, event, impl, effectSink);
  }
  ctx = runActions(chosen.actions, ctx, event, impl, effectSink);
  if (isExternal && nextState) {
    ctx = runActions(nextState.entry, ctx, event, impl, effectSink);
  }
  const status = nextState?.final === true ? "final" : "active";
  const nextSnapshot = freezeSnapshot({
    value: nextStateValue,
    context: ctx,
    status
  });
  return Object.freeze({
    snapshot: nextSnapshot,
    effects: Object.freeze(effectSink.slice()),
    changed: true
  });
}

// src/fsm/runtime.ts
var RuntimeDisposedError = class extends Error {
  constructor() {
    super("aifsmjs: runtime has been disposed; send()/reset() are not allowed");
    this.name = "RuntimeDisposedError";
  }
};
var SubMachineError = class extends Error {
  parentState;
  phase;
  cause;
  constructor(parentState, phase, cause) {
    super(`aifsmjs: sub-machine ${phase} failed at parent state "${parentState}"`, { cause });
    this.name = "SubMachineError";
    this.parentState = parentState;
    this.phase = phase;
    this.cause = cause;
  }
};
var RESET_EVENT = Object.freeze({ type: RESET_EVENT_TYPE });
function composeMiddleware(middleware) {
  return (ctx, finalNext) => {
    let index = -1;
    const dispatch = (i) => {
      if (i <= index) throw new Error("aifsmjs: next() called multiple times in middleware");
      index = i;
      const fn = middleware[i];
      if (!fn) {
        finalNext();
        return;
      }
      fn(ctx, () => dispatch(i + 1));
    };
    dispatch(0);
  };
}
function createRuntime(def, impl, opts = {}) {
  let snapshot = initialSnapshot(def);
  const listeners = /* @__PURE__ */ new Set();
  const middlewareChain = opts.middleware && opts.middleware.length > 0 ? composeMiddleware(opts.middleware) : void 0;
  const shouldDispatch = opts.dispatchEffects !== false;
  const controller = new AbortController();
  let disposed = false;
  let childRuntime;
  let childAbortCleanup;
  const eventListeners = {
    transition: /* @__PURE__ */ new Set(),
    error: /* @__PURE__ */ new Set(),
    dispose: /* @__PURE__ */ new Set()
  };
  const externalAbortCleanups = /* @__PURE__ */ new Set();
  function emit(type, payload) {
    for (const fn of eventListeners[type]) fn(payload);
  }
  function notify(committed) {
    const captured = committed ?? snapshot;
    for (const l of listeners) l(captured);
  }
  function runMiddleware(prev, event, effects, changed) {
    if (!middlewareChain) return;
    middlewareChain(deepFreeze({ prev, next: snapshot, event, effects, changed }), () => {
    });
  }
  function dispatchEffects(effects, context, event) {
    if (!impl.effects || effects.length === 0) return;
    for (const eff of effects) {
      const handler = impl.effects[eff.type];
      if (!handler) continue;
      const r = handler(eff, { context, event, signal: controller.signal });
      if (r instanceof Promise) {
        r.catch((err) => {
          emit("error", { error: err, event });
        });
      }
    }
  }
  function wireChildAbort(child) {
    if (controller.signal.aborted) {
      try {
        child.dispose();
      } catch {
      }
      return () => {
      };
    }
    const onAbort = () => {
      try {
        child.dispose();
      } catch {
      }
    };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    return () => controller.signal.removeEventListener("abort", onAbort);
  }
  function findChosenIsExternal(value, event, context) {
    const state = def.states[value];
    if (!state?.on) return false;
    const candidates = state.on[event.type];
    if (!candidates) return false;
    const list = Array.isArray(candidates) ? candidates : [candidates];
    for (const t of list) {
      if (!t.guard || evalGuard(t.guard, context, event, impl, value)) {
        return t.target !== void 0;
      }
    }
    return false;
  }
  function applySubLifecycle(prevValue, nextValue) {
    const prevStateDef = def.states[prevValue];
    const nextStateDef = def.states[nextValue];
    if (prevStateDef?.sub !== void 0 && childRuntime !== void 0) {
      const child = childRuntime;
      childRuntime = void 0;
      childAbortCleanup?.();
      childAbortCleanup = void 0;
      try {
        child.dispose();
      } catch (cause) {
        throw new SubMachineError(prevValue, "dispose", cause);
      }
    }
    if (nextStateDef?.sub !== void 0) {
      let newChild;
      try {
        newChild = createRuntime(nextStateDef.sub, nextStateDef.subImpl ?? {});
      } catch (cause) {
        throw new SubMachineError(nextValue, "init", cause);
      }
      childRuntime = newChild;
      childAbortCleanup = wireChildAbort(newChild);
    }
  }
  function send(event) {
    if (disposed) throw new RuntimeDisposedError();
    const prev = snapshot;
    const result = step(def, prev, event, impl);
    const isExternal = result.changed && (prev.value !== result.snapshot.value || findChosenIsExternal(prev.value, event, prev.context));
    if (result.changed && isExternal) applySubLifecycle(prev.value, result.snapshot.value);
    snapshot = result.snapshot;
    const committed = result.snapshot;
    runMiddleware(prev, event, result.effects, result.changed);
    if (shouldDispatch) dispatchEffects(result.effects, committed.context, event);
    if (result.changed) {
      notify(committed);
      emit("transition", {
        prev,
        next: committed,
        event,
        effects: result.effects,
        changed: true
      });
    }
    return snapshot;
  }
  function reset(event) {
    if (disposed) throw new RuntimeDisposedError();
    const prev = snapshot;
    const nextSnap = initialSnapshot(def);
    const changed = prev.value !== nextSnap.value;
    if (childRuntime) {
      const child = childRuntime;
      childRuntime = void 0;
      childAbortCleanup?.();
      childAbortCleanup = void 0;
      try {
        child.dispose();
      } catch (cause) {
        throw new SubMachineError(prev.value, "dispose", cause);
      }
    }
    const initStateDef = def.states[nextSnap.value];
    if (initStateDef?.sub) {
      let newChild;
      try {
        newChild = createRuntime(initStateDef.sub, initStateDef.subImpl ?? {});
      } catch (cause) {
        throw new SubMachineError(nextSnap.value, "init", cause);
      }
      childRuntime = newChild;
      childAbortCleanup = wireChildAbort(newChild);
    }
    snapshot = nextSnap;
    const triggerEvent = event ?? RESET_EVENT;
    runMiddleware(prev, triggerEvent, [], changed);
    if (changed) {
      notify();
      emit("transition", {
        prev,
        next: snapshot,
        event: triggerEvent,
        effects: [],
        changed: true
      });
    }
    return snapshot;
  }
  function can(event) {
    if (disposed || snapshot.status === "final") return false;
    const state = def.states[snapshot.value];
    if (!state) return false;
    const candidates = state.on?.[event.type];
    if (!candidates) return false;
    const list = Array.isArray(candidates) ? candidates : [candidates];
    for (const t of list) {
      if (!t.guard) return true;
      if (evalGuard(t.guard, snapshot.context, event, impl, snapshot.value)) return true;
    }
    return false;
  }
  function on(type, listener, options) {
    if (disposed || options?.signal?.aborted) return () => {
    };
    const target = eventListeners[type];
    let detachAbort;
    const cleanup = () => {
      target.delete(wrapped);
      if (detachAbort) {
        detachAbort();
        externalAbortCleanups.delete(detachAbort);
      }
    };
    let wrapped = listener;
    if (options?.once) {
      wrapped = (payload) => {
        cleanup();
        listener(payload);
      };
    }
    target.add(wrapped);
    const signal = options?.signal;
    if (signal) {
      const onAbort = () => cleanup();
      signal.addEventListener("abort", onAbort, { once: true });
      detachAbort = () => signal.removeEventListener("abort", onAbort);
      externalAbortCleanups.add(detachAbort);
    }
    return cleanup;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (childRuntime) {
      childAbortCleanup?.();
      childAbortCleanup = void 0;
      try {
        childRuntime.dispose();
      } catch {
      }
      childRuntime = void 0;
    }
    controller.abort();
    listeners.clear();
    emit("dispose", void 0);
    for (const set of Object.values(eventListeners)) set.clear();
    for (const cleanup of externalAbortCleanups) cleanup();
    externalAbortCleanups.clear();
  }
  const runtime = {
    getSnapshot: () => snapshot,
    snapshot: () => snapshot,
    send,
    can,
    reset,
    dispose,
    on,
    get disposed() {
      return disposed;
    },
    get signal() {
      return controller.signal;
    },
    subscribe(listener) {
      if (disposed) return () => {
      };
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subRuntime: () => childRuntime,
    onTransition: (handler, options) => on("transition", handler, options)
  };
  const bootStateDef = def.states[snapshot.value];
  if (bootStateDef?.sub) {
    let newChild;
    try {
      newChild = createRuntime(bootStateDef.sub, bootStateDef.subImpl ?? {});
    } catch (cause) {
      throw new SubMachineError(snapshot.value, "init", cause);
    }
    childRuntime = newChild;
    childAbortCleanup = wireChildAbort(newChild);
  }
  return runtime;
}

// src/fsm/definition.ts
var InvalidDefinitionError = class extends Error {
  constructor(message) {
    super(`aifsmjs: ${message}`);
    this.name = "InvalidDefinitionError";
  }
};
function validateDefinition(def) {
  if (!def.id || typeof def.id !== "string") {
    throw new InvalidDefinitionError("definition must have a non-empty string `id`");
  }
  if (!def.states || typeof def.states !== "object") {
    throw new InvalidDefinitionError("definition must have a `states` object");
  }
  const stateKeys = Object.keys(def.states);
  if (stateKeys.length === 0) {
    throw new InvalidDefinitionError("`states` must declare at least one state");
  }
  if (!def.initial || !stateKeys.includes(def.initial)) {
    throw new InvalidDefinitionError(
      `\`initial\` "${String(def.initial)}" is not declared in states (${stateKeys.join(", ")})`
    );
  }
  for (const [stateName, stateDef] of Object.entries(def.states)) {
    if (stateDef.sub !== void 0) {
      const sub = stateDef.sub;
      const subStates = sub.states;
      if (typeof sub !== "object" || sub === null || typeof subStates !== "object" || subStates === null || typeof sub.initial !== "string") {
        throw new InvalidDefinitionError(
          `state "${stateName}".sub is not a valid sub-machine definition (missing states or initial)`
        );
      }
    }
    if (!stateDef.on) continue;
    for (const [evtType, entry] of Object.entries(stateDef.on)) {
      const transitions = Array.isArray(entry) ? entry : [entry];
      for (const t of transitions) {
        if (t.target !== void 0 && !stateKeys.includes(t.target)) {
          throw new InvalidDefinitionError(
            `transition ${stateName} -[${evtType}]-> "${String(t.target)}" targets an unknown state`
          );
        }
        if (t.guard !== void 0 && isAsyncGuardFn(t.guard)) {
          throw new InvalidDefinitionError(
            `transition ${stateName} -[${evtType}]-> uses an async guard. Guards must be sync; move I/O into an effect.`
          );
        }
      }
    }
  }
}
function defineMachine(def) {
  validateDefinition(def);
  return def;
}
function setup() {
  return {
    defineMachine: (def) => {
      const cast = def;
      validateDefinition(cast);
      return cast;
    }
  };
}
function initialSnapshot(def) {
  const isFinal = def.states[def.initial]?.final === true;
  return freezeSnapshot({
    value: def.initial,
    context: def.context,
    status: isFinal ? "final" : "active"
  });
}
function createMachine(def, impl, opts) {
  return createRuntime(defineMachine(def), impl, opts ?? {});
}

// src/fsm/resolver.ts
function resolveTransitions(def, stateValue, eventType) {
  const state = def.states[stateValue];
  if (!state || !state.on) return [];
  const entry = state.on[eventType];
  if (!entry) return [];
  return Array.isArray(entry) ? entry : [entry];
}

export { AsyncGuardError, InvalidDefinitionError, RESET_EVENT_TYPE, RuntimeDisposedError, SubMachineError, UnknownActionError, UnknownGuardError, assign, createMachine, createRuntime, createSnapshot, deepFreeze, defineMachine, evalGuard, freezeSnapshot, initialSnapshot, isAsyncGuardFn, mergeContext, resolveGuard, resolveTransitions, setup, step };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map