type AfterHandle = Readonly<{
    cancel(): void;
}>;
type SetTimeoutFn = (fn: () => void, ms: number) => unknown;
type ClearTimeoutFn = (handle: unknown) => void;
type AfterOptions = Readonly<{
    /**
     * If supplied and aborted, the callback never runs and any pending timer is
     * cleared. Aborting after fire is a no-op.
     */
    signal?: AbortSignal;
    /**
     * Override `setTimeout` (testing, SSR, custom loops). Defaults to globalThis.
     */
    setTimeout?: SetTimeoutFn;
    /**
     * Override `clearTimeout`. Must match the `setTimeout` you injected.
     */
    clearTimeout?: ClearTimeoutFn;
}>;
/**
 * Schedule `fn` to run after `ms` milliseconds. Returns a handle whose
 * `cancel()` clears the pending timer. Optional `signal` aborts the timer when
 * triggered. Aborting after the callback fires is a no-op.
 *
 * The abort listener is registered with `{ once: true }` as a baseline, but
 * `{ once: true }` alone does NOT prevent listener accumulation when the same
 * signal is reused across many timers: it only removes the listener when the
 * signal aborts, not when the timer fires normally or `cancel()` is called.
 * We therefore explicitly call `signal.removeEventListener("abort", cancel)`
 * inside the fire callback and at the end of `cancel()` so that a shared,
 * long-lived signal never accumulates dead listeners across timer reuse.
 */
declare function after(ms: number, fn: () => void, opts?: AfterOptions): AfterHandle;
type Scheduler = Readonly<{
    after(ms: number, fn: () => void, opts?: AfterOptions): AfterHandle;
    cancelAll(): void;
    readonly size: number;
}>;
/**
 * Build a scheduler that tracks every pending `after()` so they can be
 * cancelled together (e.g. on machine destroy). Each `after` returns a handle
 * whose `cancel()` also removes it from the tracking set.
 *
 * `defaults` are merged into every call — typically you inject `setTimeout` /
 * `clearTimeout` once at construction.
 */
declare function createScheduler(defaults?: AfterOptions): Scheduler;

export { type AfterHandle, type AfterOptions, type ClearTimeoutFn, type Scheduler, type SetTimeoutFn, after, createScheduler };
