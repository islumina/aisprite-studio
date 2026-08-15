import { createRuntime, initialSnapshot } from '../chunk-LG2AH5X6.js';
import { replay } from '../chunk-NEJYZAKR.js';
import { step, mergeContext, normalizeTransitions } from '../chunk-ZLQ7HZCE.js';
import '../chunk-JKZAOPQC.js';
import '../chunk-A7U7QQL5.js';
import { __export } from '../chunk-PZ5AY32C.js';
import * as fc2 from 'fast-check';
import { isDeepStrictEqual } from 'util';

function initialModel(def) {
  return {
    value: def.initial,
    context: def.context,
    status: def.states[def.initial]?.final ? "final" : "active",
    reached: /* @__PURE__ */ new Set([def.initial])
  };
}
var SendCommand = class {
  constructor(event, def, impl) {
    this.event = event;
    this.def = def;
    this.impl = impl;
  }
  event;
  def;
  impl;
  check(_m) {
    return true;
  }
  run(m, r) {
    const before = r.getSnapshot();
    r.send(this.event);
    const after = r.getSnapshot();
    const predicted = step(this.def, before, this.event, this.impl);
    if (predicted.snapshot.value !== after.value) {
      throw new Error(
        `aifsmjs/pbt: determinism violation \u2014 predicted "${String(predicted.snapshot.value)}" but runtime returned "${String(after.value)}" after ${this.toString()}`
      );
    }
    m.value = after.value;
    m.context = after.context;
    m.status = after.status;
    m.reached.add(after.value);
  }
  toString() {
    return `send(${JSON.stringify(this.event)})`;
  }
};
function commandsFromMachine(def, impl, eventArbitraries) {
  const arbs = [];
  for (const arb of Object.values(eventArbitraries)) {
    arbs.push(arb.map((event) => new SendCommand(event, def, impl)));
  }
  return fc2.commands(arbs, { size: "+1" });
}

// src/pbt/properties.ts
var properties_exports = {};
__export(properties_exports, {
  assertAll: () => assertAll,
  assignDoesNotMutate: () => assignDoesNotMutate,
  contextEquals: () => contextEquals,
  guardsFalseNoTransition: () => guardsFalseNoTransition,
  reachableStatesSubsetDeclared: () => reachableStatesSubsetDeclared,
  replayEqualsFold: () => replayEqualsFold,
  snapshotAlwaysFrozen: () => snapshotAlwaysFrozen,
  unknownEventNoOp: () => unknownEventNoOp
});
function buildAssertOpts(opts) {
  const out = {};
  if (opts?.numRuns !== void 0) out.numRuns = opts.numRuns;
  if (opts?.seed !== void 0) out.seed = opts.seed;
  if (opts?.verbose) out.verbose = true;
  return out;
}
function contextEquals(a, b) {
  return isDeepStrictEqual(a, b);
}
function snapshotAlwaysFrozen(def, impl, eventArbitraries, opts) {
  fc2.assert(
    fc2.property(commandsFromMachine(def, impl, eventArbitraries), (cmds) => {
      const real = createRuntime(def, impl);
      const model = initialModel(def);
      fc2.modelRun(() => ({ model, real }), cmds);
      return Object.isFrozen(real.getSnapshot());
    }),
    buildAssertOpts(opts)
  );
}
function unknownEventNoOp(def, impl, unknownType, opts) {
  fc2.assert(
    fc2.property(fc2.constant(unknownType), (t) => {
      const initial = initialSnapshot(def);
      const result = step(def, initial, { type: t }, impl);
      return result.changed === false && result.snapshot === initial && result.effects.length === 0;
    }),
    buildAssertOpts(opts)
  );
}
function reachableStatesSubsetDeclared(def, impl, eventArbitraries, opts) {
  const declared = new Set(Object.keys(def.states));
  fc2.assert(
    fc2.property(commandsFromMachine(def, impl, eventArbitraries), (cmds) => {
      const real = createRuntime(def, impl);
      const model = initialModel(def);
      fc2.modelRun(() => ({ model, real }), cmds);
      for (const s of model.reached) {
        if (!declared.has(s)) return false;
      }
      return declared.has(real.getSnapshot().value);
    }),
    buildAssertOpts(opts)
  );
}
function replayEqualsFold(def, impl, eventArbitraries, opts) {
  const eventArb = fc2.oneof(...Object.values(eventArbitraries));
  fc2.assert(
    fc2.property(fc2.array(eventArb, { maxLength: 32 }), (events) => {
      const real = createRuntime(def, impl, { dispatchEffects: false });
      for (const e of events) real.send(e);
      const live = real.getSnapshot();
      const replayed = replay(initialSnapshot(def), events, def, impl).snapshot;
      return live.value === replayed.value && contextEquals(live.context, replayed.context);
    }),
    buildAssertOpts(opts)
  );
}
function guardsFalseNoTransition(def, impl, eventArbitraries, opts) {
  const blockedGuards = new Proxy(
    {},
    {
      get: () => () => false
    }
  );
  const blockedImpl = {
    ...impl,
    guards: blockedGuards
  };
  const isFullyGuarded = (value, eventType) => {
    const candidates = normalizeTransitions(def.states[value]?.on?.[eventType]);
    return candidates.length > 0 && candidates.every((t) => t.guard !== void 0);
  };
  fc2.assert(
    fc2.property(
      fc2.array(fc2.oneof(...Object.values(eventArbitraries)), { maxLength: 16 }),
      (events) => {
        let snap = initialSnapshot(def);
        for (const e of events) {
          const fullyGuarded = isFullyGuarded(snap.value, e.type);
          const r = step(def, snap, e, blockedImpl);
          if (fullyGuarded && r.changed !== false) return false;
          snap = r.snapshot;
        }
        return true;
      }
    ),
    buildAssertOpts(opts)
  );
}
function assignDoesNotMutate(def, impl, eventArbitraries, opts) {
  const dummy = { a: 1, b: 2 };
  const merged = mergeContext(dummy, { b: 3 });
  if (merged === dummy) throw new Error("aifsmjs/pbt: mergeContext returned the same reference");
  fc2.assert(
    fc2.property(
      fc2.array(fc2.oneof(...Object.values(eventArbitraries)), { maxLength: 16 }),
      (events) => {
        let snap = initialSnapshot(def);
        for (const e of events) {
          const beforeCtx = structuredClone(snap.context);
          step(def, snap, e, impl);
          if (!contextEquals(snap.context, beforeCtx)) return false;
          snap = step(def, snap, e, impl).snapshot;
        }
        return true;
      }
    ),
    buildAssertOpts(opts)
  );
}
function assertAll(def, impl, eventArbitraries, opts) {
  snapshotAlwaysFrozen(def, impl, eventArbitraries, opts);
  unknownEventNoOp(def, impl, opts?.unknownEventType ?? "__AIFSMJS_UNKNOWN__", opts);
  reachableStatesSubsetDeclared(def, impl, eventArbitraries, opts);
  replayEqualsFold(def, impl, eventArbitraries, opts);
  guardsFalseNoTransition(def, impl, eventArbitraries, opts);
  assignDoesNotMutate(def, impl, eventArbitraries, opts);
}

// src/pbt/index.ts
var properties = properties_exports;

export { assertAll, assignDoesNotMutate, commandsFromMachine, guardsFalseNoTransition, initialModel, properties, reachableStatesSubsetDeclared, replayEqualsFold, snapshotAlwaysFrozen, unknownEventNoOp };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map