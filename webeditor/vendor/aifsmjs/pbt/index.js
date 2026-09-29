import { createRuntime, initialSnapshot } from '../chunk-XA24A7VP.js';
import { replay } from '../chunk-Q45LGXHO.js';
import { step, normalizeTransitions } from '../chunk-D6H64FSI.js';
import '../chunk-JKZAOPQC.js';
import { ownValue } from '../chunk-SSNKGEVB.js';
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
      const real = createRuntime(def, impl, { dispatchEffects: false });
      try {
        const model = initialModel(def);
        fc2.modelRun(() => ({ model, real }), cmds);
        return Object.isFrozen(real.getSnapshot());
      } finally {
        real.dispose();
      }
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
      const real = createRuntime(def, impl, { dispatchEffects: false });
      try {
        const model = initialModel(def);
        fc2.modelRun(() => ({ model, real }), cmds);
        for (const s of model.reached) {
          if (!declared.has(s)) return false;
        }
        return declared.has(real.getSnapshot().value);
      } finally {
        real.dispose();
      }
    }),
    buildAssertOpts(opts)
  );
}
function replayEqualsFold(def, impl, eventArbitraries, opts) {
  const eventArb = fc2.oneof(...Object.values(eventArbitraries));
  fc2.assert(
    fc2.property(fc2.array(eventArb, { maxLength: 32 }), (events) => {
      const real = createRuntime(def, impl, { dispatchEffects: false });
      try {
        for (const e of events) real.send(e);
        const live = real.getSnapshot();
        const replayed = replay(initialSnapshot(def), events, def, impl).snapshot;
        return live.value === replayed.value && contextEquals(live.context, replayed.context);
      } finally {
        real.dispose();
      }
    }),
    buildAssertOpts(opts)
  );
}
function guardsFalseNoTransition(def, impl, eventArbitraries, opts) {
  const blockedGuards = new Proxy(
    {},
    {
      get: () => () => false,
      getOwnPropertyDescriptor: () => ({ configurable: true })
    }
  );
  const blockedImpl = {
    ...impl,
    guards: blockedGuards
  };
  const isFullyGuarded = (value, eventType) => {
    const candidates = normalizeTransitions(ownValue(def.states[value]?.on, eventType));
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
var ownState = (v) => [
  ...Reflect.ownKeys(v).flatMap((k) => [k, v[k]]),
  ...v instanceof Map || v instanceof Set ? [...v.entries()].flat() : [],
  v instanceof Date && v.getTime()
];
function assignDoesNotMutate(def, impl, eventArbitraries, opts) {
  fc2.assert(
    fc2.property(
      fc2.array(fc2.oneof(...Object.values(eventArbitraries)), { maxLength: 16 }),
      (events) => {
        let snap = initialSnapshot(def);
        for (const e of events) {
          const before = /* @__PURE__ */ new Map();
          const walk = (v) => {
            if (!v || typeof v !== "object" || before.has(v)) return;
            const own = ownState(v);
            before.set(v, own);
            own.forEach(walk);
          };
          walk(snap.context);
          snap = step(def, snap, e, impl).snapshot;
          for (const [obj, own] of before) if (!contextEquals(ownState(obj), own)) return false;
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
var properties = Object.freeze({
  assertAll,
  assignDoesNotMutate,
  contextEquals,
  guardsFalseNoTransition,
  reachableStatesSubsetDeclared,
  replayEqualsFold,
  snapshotAlwaysFrozen,
  unknownEventNoOp
});

export { assertAll, assignDoesNotMutate, commandsFromMachine, guardsFalseNoTransition, initialModel, properties, reachableStatesSubsetDeclared, replayEqualsFold, snapshotAlwaysFrozen, unknownEventNoOp };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map