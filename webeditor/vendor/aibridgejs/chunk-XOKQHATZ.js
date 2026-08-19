import { BridgeError, BridgeDisposedError, isValidEnvelope } from './chunk-4SMOCFWS.js';

// src/iframe/index.ts
function inferPostTarget(host) {
  const parentCandidate = host.parent;
  if (parentCandidate && parentCandidate !== host && typeof parentCandidate.postMessage === "function") {
    return parentCandidate;
  }
  const self = host;
  if (typeof self.postMessage === "function") {
    return host;
  }
  return null;
}
function createIframeAdapter(host, options) {
  if (!options.targetOrigin || options.targetOrigin === "*") {
    throw new Error("iframe adapter requires an exact targetOrigin (wildcard '*' is forbidden)");
  }
  let normalisedOrigin;
  try {
    normalisedOrigin = new URL(options.targetOrigin).origin;
  } catch {
    throw new BridgeError(
      `iframe adapter requires a valid absolute origin for targetOrigin (got ${JSON.stringify(options.targetOrigin)})`
    );
  }
  if (normalisedOrigin === "null" || options.targetOrigin !== normalisedOrigin) {
    throw new BridgeError(
      `iframe adapter requires an exact origin for targetOrigin (got ${JSON.stringify(options.targetOrigin)}, expected ${JSON.stringify(normalisedOrigin)})`
    );
  }
  const targetOrigin = options.targetOrigin;
  const postTarget = options.postTarget ?? inferPostTarget(host);
  const expectedSource = "expectedSource" in options ? options.expectedSource : postTarget ?? null;
  const subscribers = /* @__PURE__ */ new Set();
  const subCleanups = /* @__PURE__ */ new Set();
  let disposed = false;
  const messageHandler = (event) => {
    if (disposed) return;
    if (event.origin !== targetOrigin) return;
    if (expectedSource != null && event.source !== expectedSource) return;
    if (!isValidEnvelope(event.data)) return;
    for (const sub of Array.from(subscribers)) {
      sub(event.data, { origin: event.origin, source: event.source });
    }
  };
  host.addEventListener("message", messageHandler);
  return {
    platform: "iframe",
    async ready() {
      if (disposed) throw new BridgeDisposedError();
    },
    async post(message) {
      if (disposed) throw new BridgeDisposedError();
      if (!postTarget) {
        throw new Error("iframe adapter has no postMessage target");
      }
      postTarget.postMessage(message, targetOrigin);
    },
    subscribe(listener, opts) {
      if (disposed) return () => {
      };
      subscribers.add(listener);
      const signal = opts?.signal;
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
    /** @internal Test-only helper. Not part of the public contract. */
    dispatchTestMessage(envelope, meta) {
      messageHandler({
        data: envelope,
        origin: meta.origin,
        source: "source" in meta ? meta.source : expectedSource
      });
    },
    dispose() {
      disposed = true;
      host.removeEventListener("message", messageHandler);
      for (const off of Array.from(subCleanups)) off();
      subscribers.clear();
    }
  };
}

export { createIframeAdapter };
//# sourceMappingURL=chunk-XOKQHATZ.js.map
//# sourceMappingURL=chunk-XOKQHATZ.js.map