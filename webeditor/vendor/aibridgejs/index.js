import { isObject, invalid, isValidEnvelope, BridgeRemoteError, BridgeResetError, BridgeDisposedError, BridgeTimeoutError } from './chunk-NI6QJ52U.js';
export { BridgeDisposedError, BridgeError, BridgeRemoteError, BridgeResetError, BridgeTimeoutError } from './chunk-NI6QJ52U.js';

// src/id.ts
function generateId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.random() * 16 | 0;
    const v = ch === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
function now() {
  return Date.now();
}

// src/bridge.ts
function attempt(fn) {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.reject(err);
  }
}
var DEFAULT_TIMEOUT_MS = 1e4;
var MAX_TIMER_DELAY_MS = 2147483647;
var ADAPTER_METHODS = ["ready", "post", "subscribe", "dispose"];
function timeoutOr(timeoutMs, fallback) {
  return timeoutMs === void 0 || Number.isNaN(timeoutMs) ? fallback : timeoutMs;
}
function clampDelay(timeoutMs) {
  if (!(timeoutMs > 0) || timeoutMs === Number.POSITIVE_INFINITY) return void 0;
  return Math.min(timeoutMs, MAX_TIMER_DELAY_MS);
}
function createBridge(options) {
  if (!isObject(options)) invalid("options", "an object");
  const adapter = options.adapter;
  if (!isObject(adapter) || ADAPTER_METHODS.some((key) => typeof adapter[key] !== "function")) {
    invalid("adapter", "an object with ready, post, subscribe and dispose functions");
  }
  const defaultTimeoutMs = timeoutOr(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const inflight = /* @__PURE__ */ new Set();
  const pending = /* @__PURE__ */ new Map();
  const events = /* @__PURE__ */ new Map();
  let disposed = false;
  let readyPromise = null;
  let round = null;
  const unsubscribeAdapter = adapter.subscribe((envelope) => {
    if (disposed) return;
    if (!isValidEnvelope(envelope)) return;
    switch (envelope.kind) {
      case "response": {
        const id = envelope.id;
        const entry = pending.get(id);
        if (!entry) return;
        let ok;
        let payload;
        let errorObject;
        let readThrew = false;
        try {
          ok = envelope.ok;
          if (ok) {
            payload = envelope.payload;
          } else {
            errorObject = envelope.error;
          }
        } catch {
          ok = false;
          payload = void 0;
          errorObject = void 0;
          readThrew = true;
        }
        if (!readThrew && ok) {
          entry.resolve(payload);
          return;
        }
        let message = "Remote error";
        let code = "REMOTE_ERROR";
        let detail;
        try {
          const rawMessage = errorObject?.message;
          const rawCode = errorObject?.code;
          if (typeof rawMessage === "string") message = rawMessage;
          if (typeof rawCode === "string") code = rawCode;
          detail = errorObject?.detail;
        } catch {
        }
        entry.reject(new BridgeRemoteError(message, code, detail));
        return;
      }
      case "event": {
        let eventName;
        let eventPayload;
        try {
          eventName = envelope.event;
          eventPayload = envelope.payload;
        } catch {
          return;
        }
        if (typeof eventName !== "string") return;
        const set = events.get(eventName);
        if (!set) return;
        for (const listenerEntry of Array.from(set)) {
          if (disposed) break;
          if (listenerEntry.removed) continue;
          try {
            listenerEntry.fn(eventPayload);
          } catch {
          }
        }
        return;
      }
      case "request": {
        return;
      }
    }
  });
  function throwIfDisposed() {
    if (disposed) throw new BridgeDisposedError();
  }
  function ready(opts) {
    throwIfDisposed();
    const userSignal = opts?.signal;
    if (userSignal?.aborted) {
      return Promise.reject(userSignal.reason);
    }
    if (!readyPromise) {
      const controller = new AbortController();
      const { signal } = controller;
      round = controller;
      readyPromise = new Promise((resolve, reject) => {
        const settle = (fn) => {
          signal.removeEventListener("abort", onAbort);
          if (round === controller) round = null;
          fn();
        };
        const onAbort = () => settle(() => reject(signal.reason));
        signal.addEventListener("abort", onAbort, { once: true });
        attempt(() => adapter.ready(signal)).then(
          () => settle(resolve),
          (err) => settle(() => reject(err))
        );
      });
    }
    if (!userSignal) {
      return readyPromise;
    }
    return new Promise((resolve, reject) => {
      const onUserAbort = () => {
        userSignal.removeEventListener("abort", onUserAbort);
        reject(userSignal.reason);
      };
      userSignal.addEventListener("abort", onUserAbort, { once: true });
      readyPromise.then(
        () => {
          userSignal.removeEventListener("abort", onUserAbort);
          resolve();
        },
        (err) => {
          userSignal.removeEventListener("abort", onUserAbort);
          reject(err);
        }
      );
    });
  }
  function send(signal, delay, timeoutMessage, envelope, id) {
    return new Promise((resolve, reject) => {
      let timer;
      const settle = (fn) => {
        if (!inflight.delete(entry)) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (id !== void 0) pending.delete(id);
        fn();
      };
      const entry = {
        resolve: (value) => settle(() => resolve(value)),
        reject: (reason) => settle(() => reject(reason))
      };
      const onAbort = () => entry.reject(signal?.reason);
      inflight.add(entry);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (delay !== void 0) {
        timer = setTimeout(() => entry.reject(new BridgeTimeoutError(timeoutMessage)), delay);
      }
      ready().then(() => {
        if (!inflight.has(entry)) return;
        if (id !== void 0) pending.set(id, entry);
        return attempt(() => adapter.post(envelope()));
      }).then(id === void 0 ? entry.resolve : void 0, entry.reject);
    });
  }
  async function call(method, payload, opts) {
    throwIfDisposed();
    const signal = opts?.signal;
    if (signal?.aborted) {
      throw signal.reason;
    }
    const id = generateId();
    return send(
      signal,
      clampDelay(timeoutOr(opts?.timeoutMs, defaultTimeoutMs)),
      `Call timeout: ${method}`,
      () => ({ kind: "request", id, method, payload, timestamp: now() }),
      id
    );
  }
  async function emit(event, payload, opts) {
    throwIfDisposed();
    const signal = opts?.signal;
    if (signal?.aborted) {
      throw signal.reason;
    }
    const timeoutMs = opts?.timeoutMs;
    return send(
      signal,
      timeoutMs === void 0 ? void 0 : clampDelay(timeoutMs),
      `Emit timeout: ${event}`,
      () => ({ kind: "event", event, payload, timestamp: now() })
    );
  }
  function on(event, listener, opts) {
    throwIfDisposed();
    if (typeof listener !== "function") invalid("listener", "a function");
    let set = events.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      events.set(event, set);
    }
    const signal = opts?.signal;
    const once = opts?.once === true;
    let entry;
    const unsubscribe = () => {
      if (entry.removed) return;
      entry.removed = true;
      const s = events.get(event);
      if (s) {
        s.delete(entry);
        if (s.size === 0) events.delete(event);
      }
      signal?.removeEventListener("abort", unsubscribe);
    };
    const wrapped = once ? (payload) => {
      unsubscribe();
      listener(payload);
    } : listener;
    entry = { fn: wrapped, unsubscribe, removed: false };
    set.add(entry);
    if (signal) {
      if (signal.aborted) {
        unsubscribe();
      } else {
        signal.addEventListener("abort", unsubscribe, { once: true });
      }
    }
    return unsubscribe;
  }
  function platform() {
    throwIfDisposed();
    return adapter.platform;
  }
  function rejectInflight(err) {
    for (const entry of Array.from(inflight)) entry.reject(err);
  }
  function endRound(reason) {
    const live = round;
    round = null;
    readyPromise = null;
    live?.abort(reason);
  }
  function reset() {
    throwIfDisposed();
    rejectInflight(new BridgeResetError());
    endRound(new BridgeResetError());
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    rejectInflight(new BridgeDisposedError());
    endRound(new BridgeDisposedError());
    const allEntries = [];
    for (const set of events.values()) allEntries.push(...set);
    events.clear();
    for (const entry of allEntries) entry.unsubscribe();
    unsubscribeAdapter();
    adapter.dispose();
  }
  return {
    ready,
    call,
    emit,
    on,
    platform,
    reset,
    dispose
  };
}

export { createBridge };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map