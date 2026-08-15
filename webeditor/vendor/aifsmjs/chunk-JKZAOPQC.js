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

export { createEnqueuer };
//# sourceMappingURL=chunk-JKZAOPQC.js.map
//# sourceMappingURL=chunk-JKZAOPQC.js.map