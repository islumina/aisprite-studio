import { assertHost, isObject, invalid, BridgeDisposedError, isValidEnvelope } from './chunk-NI6QJ52U.js';

// src/flutter/index.ts
var DEFAULT_HANDLER_NAME = "aibridgejs";
var DEFAULT_READY_EVENT = "flutterInAppWebViewPlatformReady";
function createFlutterAdapter(host, options = {}) {
  assertHost(host);
  if (!isObject(options)) invalid("options", "an object");
  const handlerName = options.handlerName ?? DEFAULT_HANDLER_NAME;
  const waitForReady = options.waitForReadyEvent ?? true;
  const readyEventName = options.readyEventName ?? DEFAULT_READY_EVENT;
  const subscribers = /* @__PURE__ */ new Set();
  const subCleanups = /* @__PURE__ */ new Set();
  let disposed = false;
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  readyPromise.catch(() => {
  });
  const onReadyEvent = () => {
    if (resolveReady) {
      const r = resolveReady;
      resolveReady = void 0;
      rejectReady = void 0;
      r();
    }
  };
  const platformReady = host.flutter_inappwebview?._platformReady === true;
  if (waitForReady && !platformReady) {
    host.addEventListener(readyEventName, onReadyEvent, { once: true });
  } else {
    onReadyEvent();
  }
  const dispatch = (envelope) => {
    if (disposed) return;
    if (!isValidEnvelope(envelope)) return;
    for (const sub of Array.from(subscribers)) {
      sub(envelope);
    }
  };
  return {
    platform: "flutter",
    ready(signal) {
      if (disposed) return Promise.reject(new BridgeDisposedError());
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (!signal) return readyPromise;
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          signal.removeEventListener("abort", onAbort);
          reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        readyPromise.then(
          () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          },
          (err) => {
            signal.removeEventListener("abort", onAbort);
            reject(err);
          }
        );
      });
    },
    async post(message) {
      if (disposed) throw new BridgeDisposedError();
      const handler = host.flutter_inappwebview;
      if (!handler?.callHandler) {
        throw new Error("flutter_inappwebview.callHandler is not available");
      }
      const result = await handler.callHandler(handlerName, message);
      if (result !== null && result !== void 0) {
        dispatch(result);
      }
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
    receive(envelope) {
      dispatch(envelope);
    },
    dispose() {
      disposed = true;
      host.removeEventListener(readyEventName, onReadyEvent);
      if (rejectReady) {
        const r = rejectReady;
        resolveReady = void 0;
        rejectReady = void 0;
        r(new BridgeDisposedError());
      }
      for (const off of Array.from(subCleanups)) off();
      subscribers.clear();
    }
  };
}

export { createFlutterAdapter };
//# sourceMappingURL=chunk-X766BQVN.js.map
//# sourceMappingURL=chunk-X766BQVN.js.map