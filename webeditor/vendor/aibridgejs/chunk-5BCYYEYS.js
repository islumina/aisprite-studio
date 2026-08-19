import { BridgeDisposedError, isValidEnvelope } from './chunk-4SMOCFWS.js';

// src/mock/index.ts
function createMockAdapter() {
  const subscribers = /* @__PURE__ */ new Set();
  const subCleanups = /* @__PURE__ */ new Set();
  let disposed = false;
  const dispatch = (envelope) => {
    if (!isValidEnvelope(envelope)) return;
    for (const sub of Array.from(subscribers)) {
      sub(envelope);
    }
  };
  return {
    platform: "mock",
    async ready() {
      if (disposed) throw new BridgeDisposedError();
    },
    async post(message) {
      if (disposed) throw new BridgeDisposedError();
      dispatch(message);
    },
    subscribe(listener, options) {
      if (disposed) return () => {
      };
      subscribers.add(listener);
      const signal = options?.signal;
      const unsubscribe = () => {
        subscribers.delete(listener);
        subCleanups.delete(unsubscribe);
        signal?.removeEventListener("abort", unsubscribe);
      };
      subCleanups.add(unsubscribe);
      if (signal) {
        if (signal.aborted) {
          unsubscribe();
        } else {
          signal.addEventListener("abort", unsubscribe, { once: true });
        }
      }
      return unsubscribe;
    },
    receive(envelope) {
      if (disposed) return;
      dispatch(envelope);
    },
    dispose() {
      disposed = true;
      for (const off of Array.from(subCleanups)) off();
      subscribers.clear();
    }
  };
}

export { createMockAdapter };
//# sourceMappingURL=chunk-5BCYYEYS.js.map
//# sourceMappingURL=chunk-5BCYYEYS.js.map