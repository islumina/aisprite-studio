import { createEnqueuer } from './chunk-JKZAOPQC.js';
import { evalGuard } from './chunk-A7U7QQL5.js';

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
  return normalizeTransitions(state.on[eventType]);
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
  const candidateList = normalizeTransitions(state.on?.[event.type]);
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

export { UnknownActionError, assign, createSnapshot, deepFreeze, freezeSnapshot, mergeContext, normalizeTransition, normalizeTransitions, resolveTransitions, step };
//# sourceMappingURL=chunk-ZLQ7HZCE.js.map
//# sourceMappingURL=chunk-ZLQ7HZCE.js.map