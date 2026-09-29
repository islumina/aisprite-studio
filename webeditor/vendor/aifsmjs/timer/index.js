// src/timer/scheduler.ts
var NOOP = Object.freeze({ cancel: () => {
} });
var MAX_DELAY = 2147483647;
var clampDelay = (ms) => Math.min(ms, MAX_DELAY);
function checkArgs(ms, fn) {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError("aifsmjs: after() ms must be a finite number >= 0");
  }
  if (typeof fn !== "function") throw new TypeError("aifsmjs: after() fn must be a function");
}
function resolveTimers(opts) {
  return {
    st: opts?.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms)),
    ct: opts?.clearTimeout ?? ((h) => globalThis.clearTimeout(h))
  };
}
function after(ms, fn, opts) {
  checkArgs(ms, fn);
  if (opts?.signal?.aborted) return NOOP;
  const { st, ct } = resolveTimers(opts);
  let fired = false;
  let cancelled = false;
  const timer = {};
  const cancel = () => {
    if (fired || cancelled) return;
    cancelled = true;
    if (timer.handle !== void 0) ct(timer.handle);
    if (opts?.signal) opts.signal.removeEventListener("abort", cancel);
  };
  timer.handle = st(() => {
    fired = true;
    if (cancelled) return;
    if (opts?.signal) opts.signal.removeEventListener("abort", cancel);
    fn();
  }, clampDelay(ms));
  if (opts?.signal && !fired) {
    opts.signal.addEventListener("abort", cancel, { once: true });
  }
  return Object.freeze({ cancel });
}
function createScheduler(defaults) {
  const pending = /* @__PURE__ */ new Set();
  const sched = {
    after(ms, fn, opts) {
      checkArgs(ms, fn);
      const signal = opts?.signal ?? defaults?.signal;
      const setTimeoutFn = opts?.setTimeout ?? defaults?.setTimeout;
      const clearTimeoutFn = opts?.clearTimeout ?? defaults?.clearTimeout;
      const innerOpts = {
        ...setTimeoutFn !== void 0 && { setTimeout: setTimeoutFn },
        ...clearTimeoutFn !== void 0 && { clearTimeout: clearTimeoutFn }
      };
      if (signal?.aborted) return NOOP;
      const slot = {};
      let fired = false;
      let settled = false;
      const detachAbort = () => {
        if (signal) signal.removeEventListener("abort", onAbort);
      };
      const settle = () => {
        if (settled) return;
        settled = true;
        if (slot.ref) pending.delete(slot.ref);
        detachAbort();
      };
      const wrapped = () => {
        fired = true;
        settle();
        fn();
      };
      const cancel = () => {
        inner.cancel();
        settle();
      };
      function onAbort() {
        cancel();
      }
      const inner = after(ms, wrapped, innerOpts);
      const handle = Object.freeze({ cancel });
      slot.ref = handle;
      if (!fired) {
        pending.add(handle);
        if (signal) signal.addEventListener("abort", onAbort, { once: true });
      }
      return handle;
    },
    cancelAll() {
      for (const h of pending) h.cancel();
      pending.clear();
    },
    get size() {
      return pending.size;
    }
  };
  return sched;
}

export { after, createScheduler };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map