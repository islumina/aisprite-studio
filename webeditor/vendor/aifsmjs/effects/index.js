export { createEnqueuer } from '../chunk-JKZAOPQC.js';
import { ownValue, isThenable } from '../chunk-SSNKGEVB.js';

// src/effects/dispatcher.ts
var NEVER_SIGNAL;
function neverSignal() {
  if (!NEVER_SIGNAL) NEVER_SIGNAL = new AbortController().signal;
  return NEVER_SIGNAL;
}
function runEffects(effects, handlers, args) {
  if (!handlers || effects.length === 0) return [];
  const signal = args.signal ?? neverSignal();
  const handlerArgs = { context: args.context, event: args.event, signal };
  const promises = [];
  for (const eff of effects) {
    const h = ownValue(handlers, eff.type);
    if (!h) continue;
    const r = h(eff, handlerArgs);
    if (isThenable(r)) promises.push(Promise.resolve(r));
  }
  return promises;
}

export { runEffects };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map