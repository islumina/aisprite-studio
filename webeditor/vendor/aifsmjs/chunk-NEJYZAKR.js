import { step } from './chunk-ZLQ7HZCE.js';

// src/replay/index.ts
function replay(initial, events, def, impl) {
  let snapshot = initial;
  const effects = [];
  for (const event of events) {
    const r = step(def, snapshot, event, impl);
    snapshot = r.snapshot;
    if (r.effects.length > 0) {
      for (const eff of r.effects) effects.push(eff);
    }
  }
  return Object.freeze({ snapshot, effects: Object.freeze(effects.slice()) });
}

export { replay };
//# sourceMappingURL=chunk-NEJYZAKR.js.map
//# sourceMappingURL=chunk-NEJYZAKR.js.map