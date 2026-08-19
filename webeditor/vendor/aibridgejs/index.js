import { isValidEnvelope, BridgeRemoteError, generateId, BridgeTimeoutError, now, BridgeResetError, BridgeDisposedError } from './chunk-4SMOCFWS.js';
export { BridgeDisposedError, BridgeError, BridgeRemoteError, BridgeResetError, BridgeTimeoutError } from './chunk-4SMOCFWS.js';

// src/bridge.ts
var DEFAULT_TIMEOUT_MS = 1e4;
function createBridge(options) {
  const adapter = options.adapter;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pending = /* @__PURE__ */ new Map();
  const events = /* @__PURE__ */ new Map();
  const internalController = new AbortController();
  let disposed = false;
  let readyPromise = null;
  let readyReject = null;
  let resetEpoch = 0;
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
        pending.delete(id);
        entry.cleanup();
        if (!readThrew && ok) {
          entry.resolve(payload);
        } else {
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
        }
        return;
      }
      case "event": {
        const set = events.get(envelope.event);
        if (!set) return;
        for (const listenerEntry of Array.from(set)) {
          try {
            listenerEntry.fn(envelope.payload);
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
      readyPromise = new Promise((resolve, reject) => {
        let onDisposed;
        const wrappedReject = (reason) => {
          internalController.signal.removeEventListener("abort", onDisposed);
          if (readyReject === wrappedReject) readyReject = null;
          reject(reason);
        };
        readyReject = wrappedReject;
        onDisposed = () => {
          wrappedReject(new BridgeDisposedError());
        };
        internalController.signal.addEventListener("abort", onDisposed, { once: true });
        adapter.ready(internalController.signal).then(
          () => {
            internalController.signal.removeEventListener("abort", onDisposed);
            if (readyReject === wrappedReject) readyReject = null;
            if (disposed) reject(new BridgeDisposedError());
            else resolve();
          },
          (err) => {
            wrappedReject(err);
          }
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
  async function call(method, payload, opts) {
    throwIfDisposed();
    const signal = opts?.signal;
    if (signal?.aborted) {
      throw signal.reason;
    }
    const capturedEpoch = resetEpoch;
    await (signal !== void 0 ? ready({ signal }) : ready());
    if (disposed) throw new BridgeDisposedError();
    if (resetEpoch !== capturedEpoch) throw new BridgeResetError();
    if (signal?.aborted) throw signal.reason;
    const id = generateId();
    const callTimeoutMs = opts?.timeoutMs ?? defaultTimeoutMs;
    return new Promise((resolve, reject) => {
      let timer;
      let abortHandler;
      const cleanup = () => {
        if (timer !== void 0) {
          clearTimeout(timer);
          timer = void 0;
        }
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
          abortHandler = void 0;
        }
      };
      pending.set(id, {
        resolve,
        reject,
        cleanup
      });
      if (callTimeoutMs > 0) {
        timer = setTimeout(() => {
          const current = pending.get(id);
          if (!current) return;
          pending.delete(id);
          current.cleanup();
          reject(new BridgeTimeoutError(`Call timeout: ${method}`));
        }, callTimeoutMs);
      }
      if (signal) {
        abortHandler = () => {
          const current = pending.get(id);
          if (!current) return;
          pending.delete(id);
          current.cleanup();
          reject(signal.reason);
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }
      const envelope = {
        kind: "request",
        id,
        method,
        payload,
        timestamp: now()
      };
      adapter.post(envelope).catch((err) => {
        const current = pending.get(id);
        if (!current) return;
        pending.delete(id);
        current.cleanup();
        reject(err);
      });
    });
  }
  async function emit(event, payload, opts) {
    throwIfDisposed();
    const signal = opts?.signal;
    if (signal?.aborted) {
      throw signal.reason;
    }
    const capturedEpoch = resetEpoch;
    await (signal !== void 0 ? ready({ signal }) : ready());
    if (disposed) throw new BridgeDisposedError();
    if (resetEpoch !== capturedEpoch) throw new BridgeResetError();
    if (signal?.aborted) throw signal.reason;
    const envelope = {
      kind: "event",
      event,
      payload,
      timestamp: now()
    };
    const emitTimeoutMs = opts?.timeoutMs;
    if ((emitTimeoutMs === void 0 || emitTimeoutMs <= 0) && signal === void 0) {
      await adapter.post(envelope);
      return;
    }
    await new Promise((resolve, reject) => {
      let timer;
      let abortHandler;
      let settled = false;
      const cleanup = () => {
        if (timer !== void 0) {
          clearTimeout(timer);
          timer = void 0;
        }
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
          abortHandler = void 0;
        }
      };
      const settleResolve = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const settleReject = (reason) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(reason);
      };
      if (emitTimeoutMs !== void 0 && emitTimeoutMs > 0) {
        timer = setTimeout(() => {
          settleReject(new BridgeTimeoutError(`Emit timeout: ${event}`));
        }, emitTimeoutMs);
      }
      if (signal) {
        abortHandler = () => {
          settleReject(signal.reason);
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }
      adapter.post(envelope).then(settleResolve, settleReject);
    });
  }
  function on(event, listener, opts) {
    throwIfDisposed();
    let set = events.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      events.set(event, set);
    }
    const signal = opts?.signal;
    const once = opts?.once === true;
    let removed = false;
    let entry;
    const unsubscribe = () => {
      if (removed) return;
      removed = true;
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
    entry = { fn: wrapped, unsubscribe };
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
  function rejectAllPending(err) {
    const entries = Array.from(pending.values());
    pending.clear();
    for (const entry of entries) {
      entry.cleanup();
      entry.reject(err);
    }
  }
  function unsubscribeAllListeners() {
    const allEntries = [];
    for (const set of events.values()) {
      for (const entry of set) allEntries.push(entry);
    }
    events.clear();
    for (const entry of allEntries) {
      entry.unsubscribe();
    }
  }
  function reset() {
    throwIfDisposed();
    resetEpoch++;
    rejectAllPending(new BridgeResetError());
    unsubscribeAllListeners();
    if (readyReject) {
      readyReject(new BridgeResetError());
      readyReject = null;
    }
    readyPromise = null;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    internalController.abort(new BridgeDisposedError());
    rejectAllPending(new BridgeDisposedError());
    unsubscribeAllListeners();
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