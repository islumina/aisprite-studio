import { freezeSnapshot, chooseTransition, normalizeTransitions, stepWithMeta, deepFreeze, IS_DEV } from './chunk-D6H64FSI.js';
import { isAsyncGuardFn, ownValue, isThenable } from './chunk-SSNKGEVB.js';

// src/fsm/types.ts
var RESET_EVENT_TYPE = "@@aifsmjs/RESET";

// src/fsm/definition.ts
var InvalidDefinitionError = class extends Error {
  constructor(message) {
    super(`aifsmjs: ${message}`);
    this.name = "InvalidDefinitionError";
  }
};
function assertObject(value, subject) {
  if (value === null || typeof value !== "object") {
    throw new InvalidDefinitionError(`${subject} must be an object`);
  }
}
function validateDefinition(def, seen = /* @__PURE__ */ new WeakSet()) {
  if (!def.id || typeof def.id !== "string") {
    throw new InvalidDefinitionError("definition must have a non-empty string `id`");
  }
  assertObject(def.states, "definition states");
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
    assertObject(stateDef, `state "${stateName}"`);
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
        assertObject(t, `transition ${stateName} -[${evtType}]->`);
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
  const path = /* @__PURE__ */ new Set();
  let d = def;
  while (d) {
    if (path.has(d)) {
      throw new InvalidDefinitionError(
        `sub-machine cycle through initial states: "${d.id}" is re-entered via initial-state subs`
      );
    }
    path.add(d);
    d = d.states[d.initial]?.sub;
  }
}
function defineMachine(def) {
  assertObject(def, "definition");
  const normalized = def.context === void 0 ? { ...def, context: {} } : def;
  validateDefinition(normalized);
  return normalized;
}
function setup() {
  return { defineMachine };
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
function assertListener(listener) {
  if (typeof listener !== "function") {
    throw new InvalidDefinitionError("listener must be a function");
  }
}
function createRuntime(def, impl, opts = {}) {
  assertObject(def, "definition");
  assertObject(def.states, "definition states");
  assertObject(impl, "implementations");
  assertObject(opts, "options");
  const middleware = opts.middleware;
  if (middleware !== void 0 && !(Array.isArray(middleware) && middleware.every((fn) => typeof fn === "function"))) {
    throw new InvalidDefinitionError("options.middleware must be an array of functions");
  }
  let snapshot = initialSnapshot(def);
  const listeners = /* @__PURE__ */ new Set();
  const middlewareChain = middleware && middleware.length > 0 ? composeMiddleware(middleware) : void 0;
  const shouldDispatch = opts.dispatchEffects !== false;
  const controller = new AbortController();
  let disposed = false;
  let dispatching = false;
  const mailbox = [];
  let childRuntime;
  const eventListeners = {
    transition: /* @__PURE__ */ new Set(),
    error: /* @__PURE__ */ new Set(),
    dispose: /* @__PURE__ */ new Set()
  };
  const externalAbortCleanups = /* @__PURE__ */ new Set();
  function emit(type, payload) {
    const set = eventListeners[type];
    let failed = false;
    let firstError;
    for (const fn of Array.from(set)) {
      if (!set.has(fn)) continue;
      try {
        fn(payload);
      } catch (err) {
        if (!failed) {
          failed = true;
          firstError = err;
        }
      }
    }
    if (failed) throw firstError;
  }
  function dispatchEffects(effects, context, event) {
    if (!impl.effects || effects.length === 0) return;
    for (const eff of effects) {
      const handler = ownValue(impl.effects, eff.type);
      if (!handler) continue;
      const r = handler(eff, { context, event, signal: controller.signal });
      if (isThenable(r)) {
        Promise.resolve(r).catch((err) => {
          if (eventListeners.error.size > 0) emit("error", { error: err, event });
          else if (IS_DEV) {
            console.warn(
              'aifsmjs: unhandled async effect rejection; register runtime.on("error", ...)',
              err
            );
          }
        });
      }
    }
  }
  function swapChild(prevValue, nextValue) {
    const stateDef = def.states[nextValue];
    let next;
    if (stateDef?.sub) {
      try {
        next = createRuntime(stateDef.sub, stateDef.subImpl ?? {});
      } catch (cause) {
        throw new SubMachineError(nextValue, "init", cause);
      }
    }
    const old = childRuntime;
    if (old) {
      childRuntime = void 0;
      try {
        old.dispose();
      } catch (cause) {
        next?.dispose();
        throw new SubMachineError(prevValue, "dispose", cause);
      }
    }
    if (disposed) next?.dispose();
    else childRuntime = next;
  }
  function commit(prev, next, event, effects, changed) {
    snapshot = next;
    middlewareChain?.(
      Object.freeze({ prev, next, event, effects: deepFreeze(effects), changed }),
      () => {
      }
    );
    if (shouldDispatch) dispatchEffects(effects, next.context, event);
    if (changed) {
      for (const l of Array.from(listeners)) if (listeners.has(l)) l(next);
      emit("transition", {
        prev,
        next,
        event,
        effects,
        changed: true
      });
    }
  }
  function processSend(event) {
    const prev = snapshot;
    const { result, external } = stepWithMeta(def, prev, event, impl);
    if (result.changed && (prev.value !== result.snapshot.value || external)) {
      swapChild(prev.value, result.snapshot.value);
    }
    commit(prev, result.snapshot, event, result.effects, result.changed);
  }
  function processReset(event) {
    const prev = snapshot;
    const next = initialSnapshot(def);
    swapChild(prev.value, next.value);
    commit(
      prev,
      next,
      event ?? RESET_EVENT,
      [],
      prev.value !== next.value || prev.status !== next.status || prev.context !== next.context
    );
  }
  function run(entry) {
    if (disposed) throw new RuntimeDisposedError();
    if ((entry.kind === "send" || entry.event !== void 0) && typeof entry.event?.type !== "string") {
      throw new InvalidDefinitionError(
        `${entry.kind}() event must be an object with a string type`
      );
    }
    if (dispatching) {
      mailbox.push(entry);
      return snapshot;
    }
    dispatching = true;
    try {
      for (let m = entry; m && !disposed; m = mailbox.shift()) {
        if (m.kind === "send") processSend(m.event);
        else processReset(m.event);
      }
    } finally {
      dispatching = false;
      mailbox.length = 0;
    }
    return snapshot;
  }
  function on(type, listener, options) {
    if (!Object.hasOwn(eventListeners, type)) {
      throw new InvalidDefinitionError('on() type must be "transition", "error" or "dispose"');
    }
    assertListener(listener);
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
    mailbox.length = 0;
    const child = childRuntime;
    childRuntime = void 0;
    try {
      child?.dispose();
    } catch {
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
    send: (event) => run({ kind: "send", event }),
    // Same candidate resolution as step(), without running any action.
    can: (event) => !disposed && chooseTransition(def, snapshot, event, impl) !== void 0,
    reset: (event) => run({ kind: "reset", event }),
    dispose,
    on,
    get disposed() {
      return disposed;
    },
    get signal() {
      return controller.signal;
    },
    subscribe(listener) {
      assertListener(listener);
      if (disposed) return () => {
      };
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subRuntime: () => childRuntime,
    onTransition: (handler, options) => on("transition", handler, options)
  };
  swapChild(snapshot.value, snapshot.value);
  return runtime;
}

export { InvalidDefinitionError, RESET_EVENT_TYPE, RuntimeDisposedError, SubMachineError, createMachine, createRuntime, defineMachine, initialSnapshot, setup };
//# sourceMappingURL=chunk-XA24A7VP.js.map
//# sourceMappingURL=chunk-XA24A7VP.js.map