import { createEnqueuer } from './chunk-JKZAOPQC.js';
import { ownValue, evalGuard } from './chunk-SSNKGEVB.js';

// src/fsm/resolver.ts
function normalizeTransition(entry) {
  return typeof entry === "string" ? { target: entry } : entry;
}
function normalizeTransitions(entry) {
  if (entry === void 0) return [];
  if (Array.isArray(entry)) {
    return entry.some((t) => typeof t === "string") ? entry.map((t) => normalizeTransition(t)) : entry;
  }
  return [normalizeTransition(entry)];
}
function resolveTransitions(def, stateValue, eventType) {
  const state = def.states[stateValue];
  if (!state || !state.on) return [];
  return normalizeTransitions(ownValue(state.on, eventType));
}

// src/fsm/snapshot.ts
var IS_DEV = false;
try {
  IS_DEV = process.env.NODE_ENV !== "production";
} catch {
}
function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
var DEEP_FROZEN = /* @__PURE__ */ new WeakSet();
function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  if (DEEP_FROZEN.has(value)) return value;
  DEEP_FROZEN.add(value);
  if (ArrayBuffer.isView(value)) return value;
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

// src/fsm/lifecycle.ts
var UnknownActionError = class extends Error {
  actionName;
  constructor(actionName) {
    super(`aifsmjs: action "${actionName}" not found in implementations.actions`);
    this.name = "UnknownActionError";
    this.actionName = actionName;
  }
};
var InvalidActionResultError = class extends Error {
  actionName;
  constructor(actionName, patch) {
    super(
      `aifsmjs: action "${actionName}" returned ${typeof patch}; an object context accepts only a plain-object patch (or undefined)`
    );
    this.name = "InvalidActionResultError";
    this.actionName = actionName;
  }
};
function resolveAction(ref, impl) {
  if (typeof ref === "function") return ref;
  const fn = ownValue(impl.actions, ref);
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
    current = mergeContext(current, patch, typeof ref === "string" ? ref : fn.name || "<inline>");
  }
  return current;
}
function chooseTransition(def, snapshot, event, impl) {
  if (snapshot.status === "final") return void 0;
  for (const t of resolveTransitions(def, snapshot.value, event.type)) {
    if (!t.guard || evalGuard(t.guard, snapshot.context, event, impl, snapshot.value)) return t;
  }
  return void 0;
}
var NO_EFFECTS = Object.freeze([]);
function stepWithMeta(def, snapshot, event, impl) {
  const chosen = chooseTransition(def, snapshot, event, impl);
  if (!chosen) {
    return {
      result: Object.freeze({ snapshot, effects: NO_EFFECTS, changed: false }),
      external: false
    };
  }
  const state = def.states[snapshot.value];
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
  return {
    result: Object.freeze({
      snapshot: nextSnapshot,
      effects: Object.freeze(effectSink.slice()),
      changed: true
    }),
    external: isExternal
  };
}
function step(def, snapshot, event, impl) {
  return stepWithMeta(def, snapshot, event, impl).result;
}

// src/fsm/updater.ts
function assign(updater) {
  return ({ context, event }) => updater({ context, event });
}
function mergeContext(current, patch, actionName = "<inline>") {
  if (patch === void 0 || patch === null) return current;
  if (current !== null && typeof current === "object" && !Array.isArray(current) && !ArrayBuffer.isView(current)) {
    if (isPlainObject(patch)) {
      return Object.setPrototypeOf({ ...current, ...patch }, Object.getPrototypeOf(current));
    }
    if (typeof patch !== "object" && typeof patch !== "function") {
      throw new InvalidActionResultError(actionName, patch);
    }
  }
  return patch;
}

export { IS_DEV, InvalidActionResultError, UnknownActionError, assign, chooseTransition, createSnapshot, deepFreeze, freezeSnapshot, mergeContext, normalizeTransition, normalizeTransitions, resolveTransitions, step, stepWithMeta };
//# sourceMappingURL=chunk-D6H64FSI.js.map
//# sourceMappingURL=chunk-D6H64FSI.js.map