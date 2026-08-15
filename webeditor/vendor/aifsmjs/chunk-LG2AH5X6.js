import { freezeSnapshot, step, normalizeTransitions, deepFreeze } from './chunk-ZLQ7HZCE.js';
import { evalGuard, isAsyncGuardFn, isThenable } from './chunk-A7U7QQL5.js';

// src/fsm/types.ts
var RESET_EVENT_TYPE = "@@aifsmjs/RESET";

// src/fsm/definition.ts
var InvalidDefinitionError = class extends Error {
  constructor(message) {
    super(`aifsmjs: ${message}`);
    this.name = "InvalidDefinitionError";
  }
};
function validateDefinition(def, seen = /* @__PURE__ */ new WeakSet()) {
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
      const subInitial = sub.initial;
      if (typeof sub !== "object" || sub === null || typeof subStates !== "object" || subStates === null || typeof subInitial !== "string" || // initial must name one of the sub's own states — otherwise the child
      // boots pointing at a non-existent state and no-ops forever (FSM-S-02).
      !Object.hasOwn(subStates, subInitial)) {
        throw new InvalidDefinitionError(
          `state "${stateName}".sub is not a valid sub-machine definition (missing states or initial)`
        );
      }
      if (!seen.has(sub)) {
        seen.add(sub);
        validateDefinition(sub, seen);
      }
    }
    if (!stateDef.on) continue;
    for (const [evtType, entry] of Object.entries(stateDef.on)) {
      const transitions = normalizeTransitions(entry);
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
  const normalized = !("context" in def) ? { ...def, context: {} } : def;
  validateDefinition(normalized);
  return normalized;
}
function setup() {
  return {
    defineMachine: (def) => {
      const cast = !("context" in def) ? { ...def, context: {} } : def;
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
    for (const fn of Array.from(eventListeners[type])) fn(payload);
  }
  function notify(committed) {
    const captured = committed ?? snapshot;
    for (const l of Array.from(listeners)) l(captured);
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
      if (isThenable(r)) {
        Promise.resolve(r).catch((err) => {
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
  function initChildFor(stateValue) {
    const stateDef = def.states[stateValue];
    const sub = stateDef?.sub;
    if (sub === void 0) return;
    let newChild;
    try {
      newChild = createRuntime(sub, stateDef.subImpl ?? {});
    } catch (cause) {
      throw new SubMachineError(stateValue, "init", cause);
    }
    childRuntime = newChild;
    childAbortCleanup = wireChildAbort(newChild);
  }
  function findChosenIsExternal(value, event, context) {
    const state = def.states[value];
    if (!state?.on) return false;
    const list = normalizeTransitions(state.on[event.type]);
    if (list.length === 0) return false;
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
      initChildFor(nextValue);
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
      initChildFor(nextSnap.value);
    }
    snapshot = nextSnap;
    const committed = nextSnap;
    const triggerEvent = event ?? RESET_EVENT;
    runMiddleware(prev, triggerEvent, [], changed);
    if (changed) {
      notify(committed);
      emit("transition", {
        prev,
        next: committed,
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
    const list = normalizeTransitions(state.on?.[event.type]);
    if (list.length === 0) return false;
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
    try {
      emit("dispose", void 0);
    } catch {
    } finally {
      for (const set of Object.values(eventListeners)) set.clear();
      for (const cleanup of externalAbortCleanups) cleanup();
      externalAbortCleanups.clear();
    }
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
    initChildFor(snapshot.value);
  }
  return runtime;
}

export { InvalidDefinitionError, RESET_EVENT_TYPE, RuntimeDisposedError, SubMachineError, createMachine, createRuntime, defineMachine, initialSnapshot, setup };
//# sourceMappingURL=chunk-LG2AH5X6.js.map
//# sourceMappingURL=chunk-LG2AH5X6.js.map