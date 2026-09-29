/**
 * Overflow strategy passed to {@link PoolOptions.onOverflow}.
 *
 * - `'throw'` (default) — throws {@link PoolError} when the pool is empty.
 * - `'null'` — {@link Pool.acquire} returns `null` instead of throwing; the pool
 *   state is not mutated.
 * - `'grow'` — doubles capacity by allocating `currentCapacity` new objects via
 *   `create()` (O(capacity) re-alloc + same-frame GC spike). Use only where
 *   unbounded growth is acceptable.
 * - function handler — called with the pool as argument; return value is added to
 *   the alive set and handed to the caller. A `null` or `undefined` return throws
 *   {@link PoolError} and leaves the pool unchanged; to signal "no object", use
 *   `'null'` instead. **Warning:** if the handler recycles
 *   an already-alive object (e.g. "evict the oldest"), the previous holder's
 *   reference is aliased — any subsequent `release` from either party may throw
 *   `PoolError("foreign or double-released")`. This is an escape hatch; caller
 *   takes full responsibility.
 *
 *   **Infinite-recursion hazard:** if the function handler calls
 *   `pool.acquire()` without first making a slot available (e.g. via
 *   `pool.release()` or `pool.drain()`), `acquire()` will find the pool still
 *   exhausted, invoke the handler again, and recurse without bound. The handler
 *   is responsible for ensuring a slot exists before any nested `acquire()` call.
 *
 * @public
 */
type OverflowHandler<T> = "throw" | "null" | "grow" | ((pool: Pool<T>) => T);
/**
 * Configuration for {@link createPool}.
 *
 * @typeParam T — the pooled object type.
 * @public
 */
interface PoolOptions<T> {
    /**
     * Factory invoked exactly `size` times at construction (and again by
     * `'grow'`). Each invocation must return a fresh instance — pool semantics
     * depend on independence between slots. Must be a function, or
     * {@link createPool} throws {@link PoolError}.
     *
     * If `create()` throws, or returns `null` or `undefined` (which throws
     * {@link PoolError}), {@link createPool} throws and no slots are kept; during
     * `'grow'` the pool is left unchanged.
     */
    create: () => T;
    /**
     * Reset hook called on every {@link Pool.release}. Must be a function, or
     * {@link createPool} throws {@link PoolError} before calling `create()`.
     * Must clear mutable fields back to a known good state without
     * `delete`-ing properties: deleting fields demotes V8 hidden classes and
     * turns the steady-state loop megamorphic.
     *
     * Prefer `obj.x = 0; obj.visible = false;` over `delete obj.x`.
     *
     * **Throwing reset permanently shrinks the pool (POL-R-01):**
     * `release()` and `drain()` both delete the object from the alive set
     * _before_ calling `reset()`. If `reset()` throws, the object is left in
     * neither the alive set nor the available stack — `alive + available` drops
     * below `size` permanently for that slot. This behaviour is intentional and
     * test-locked; guard `reset()` with a try/catch if slot loss is unacceptable.
     */
    reset: (obj: T) => void;
    /**
     * Fixed pool capacity. When the pool is exhausted, behaviour is governed
     * by {@link onOverflow} (default: throw {@link PoolError}).
     */
    size: number;
    /**
     * What to do when {@link Pool.acquire} is called on an empty pool.
     *
     * - `'throw'` (default) — throws {@link PoolError}.
     * - `'null'` — returns `null`; pool state unchanged. Use {@link NullPool}
     *   return type (auto-narrowed by the overloaded factory).
     * - `'grow'` — allocates `currentCapacity` new objects via `create()`,
     *   doubles internal capacity, then hands out one slot. O(capacity) re-alloc;
     *   expect a same-frame GC spike.
     * - function — escape hatch; see {@link OverflowHandler}.
     */
    onOverflow?: OverflowHandler<T>;
}
/**
 * Handle returned by {@link createPool}.
 *
 * @typeParam T — the pooled object type.
 * @public
 */
interface Pool<T> {
    /**
     * Take an object out of the pool. Throws {@link PoolError} when empty
     * (unless `onOverflow` changes that behaviour), throws
     * {@link PoolDisposedError} when the pool has been disposed.
     */
    acquire(): T;
    /**
     * Return an object previously obtained from {@link acquire}. Calls
     * `reset(obj)` then makes the slot available again.
     *
     * Throws {@link PoolError} on double-release or on releasing a foreign
     * object. Throws {@link PoolDisposedError} after dispose.
     */
    release(obj: T): void;
    /**
     * Reset every currently-alive object back into the available set, as if
     * each alive object were individually released. Useful between scenes
     * or rounds. No-op when nothing is alive.
     */
    drain(): void;
    /**
     * Idempotent teardown. Releases internal references so the GC can reclaim
     * pooled objects. Subsequent calls to `acquire` / `release` / `drain` /
     * `borrow` throw {@link PoolDisposedError}.
     */
    dispose(): void;
    /**
     * Acquire an object, call `fn(obj)`, then release automatically via
     * `try/finally`. Both sync and async `fn` are supported.
     *
     * **Invariants:**
     * 1. `release(obj)` is guaranteed to run in `finally` — on sync throw,
     *    async reject, or abort — unless `drain()` already reclaimed it (INV8).
     * 2. If `opts.signal` is aborted before or during `fn`, `borrow` rejects
     *    with `signal.reason` (default: `AbortError` DOMException). If the
     *    signal is already aborted before `borrow` is called, the promise
     *    rejects without ever acquiring or calling `fn`. If it aborts while
     *    `fn` is running, the rejection fires synchronously from the abort
     *    event, but the slot itself is released one microtask later, in the
     *    `finally` that runs after that rejection — synchronous code right
     *    after `ctrl.abort()` still sees the slot as held (see **INV6**).
     * 3. Abort does **not** cancel inner work — `fn` keeps running; `signal` is
     *    advisory. See **INV6** below.
     * 4. If the pool is disposed, `borrow` throws `PoolDisposedError`
     *    synchronously, before `acquire` or `fn`.
     * 5. If `onOverflow` is `'null'` and the pool is full, `borrow` throws
     *    `PoolError` synchronously; `fn` is never called.
     * 6. **Abort does not fence inner work.** When `signal` aborts, `borrow`
     *    rejects immediately, but the slot is released one microtask later (see
     *    **INV2**) — it is not freed within the same synchronous turn as
     *    `ctrl.abort()`. It does **not** cancel the work inside `fn` — the
     *    signal is advisory. If `fn` keeps touching the borrowed object after
     *    abort, it may mutate an object another caller has since acquired. `fn`
     *    must observe `signal.aborted` and stop touching the object the moment
     *    it aborts. Treat the borrowed object as invalid once `signal` fires.
     * 7. **Dispose-during-borrow:** if `dispose()` is called while an async
     *    `borrow` is in flight, the `finally` block runs `release(obj)` after
     *    the pool is already disposed — `release` throws `PoolDisposedError`,
     *    which surfaces from the `finally` block and **masks** whatever `fn`
     *    returned or threw. The caller will always see a `PoolDisposedError` in
     *    this race, regardless of `fn`'s outcome. This is an explicit invariant:
     *    do not dispose a pool that has active borrows.
     * 8. **Drain-during-borrow:** `drain()` reclaims the borrowed object too, so
     *    the `finally` block then skips `release(obj)` — it neither throws nor
     *    resets/frees the object if another caller has since acquired it. `fn`
     *    must treat the object as invalid after `drain()`, as with INV6.
     * 9. **Argument validation:** after the INV4 check and before `acquire`, a
     *    `fn` that is not a function, or an `opts.signal` without
     *    `addEventListener` / `removeEventListener`, throws `PoolError`
     *    synchronously. A `null` or `undefined` signal means no signal.
     *
     * **Sync vs async dispatch:** disposed/overflow/validation errors are thrown
     * synchronously (both overloads). A pre-aborted signal yields a rejected
     * Promise. The async branch activates only when `fn` returns a native
     * `Promise`; a non-`instanceof Promise` thenable is treated as sync —
     * release runs immediately and the thenable is returned as-is (document
     * this at call site if needed). Callers using `.catch()` instead of
     * `await` must also wrap the call in `try/catch` to handle the
     * synchronous error cases.
     */
    borrow<R>(fn: (obj: T) => R): R;
    borrow<R>(fn: (obj: T, signal?: AbortSignal) => Promise<R>, opts?: {
        signal?: AbortSignal;
    }): Promise<R>;
    /** Number of objects currently checked out. */
    readonly alive: number;
    /** Number of objects available for {@link acquire}. */
    readonly available: number;
    /** `true` once {@link dispose} has been called. */
    readonly disposed: boolean;
}
/**
 * Variant of {@link Pool} returned when `onOverflow: 'null'` is passed to
 * {@link createPool}. Identical to `Pool<T>` except `acquire()` returns
 * `T | null` instead of `T`.
 *
 * @public
 */
interface NullPool<T> extends Omit<Pool<T>, "acquire"> {
    acquire(): T | null;
}
/**
 * Recoverable pool error. Thrown by `acquire()` on overflow, by `release()`
 * on double-release or foreign-object release, by `createPool()` and
 * `borrow()` on invalid arguments, and whenever `create()` or an overflow
 * handler returns `null` or `undefined`. Every message starts with
 * `aipooljs: `; match on the class plus a regex, not the exact text.
 *
 * @public
 */
declare class PoolError extends Error {
    readonly name = "PoolError";
}
/**
 * Thrown by any pool method called after {@link Pool.dispose}.
 *
 * @public
 */
declare class PoolDisposedError extends Error {
    readonly name = "PoolDisposedError";
}
/**
 * Construct a fixed-size object pool configured to return `null` on overflow
 * (instead of throwing). The returned {@link NullPool} has `acquire(): T | null`.
 *
 * **Overload narrowing is literal-only (POL-B-02):** this overload matches only
 * when `onOverflow` is the string literal `"null"` — i.e. when TypeScript can
 * see the value at the call site. If you build a config object dynamically
 * (`const cfg = { ..., onOverflow: userSetting }`), the type of `onOverflow`
 * widens to `OverflowHandler<T>`, which matches the base `Pool<T>` overload
 * instead. In that case `acquire()` is typed as `T` even though it may return
 * `null` at runtime. Use `as const satisfies PoolOptions<T>` or an explicit
 * type cast to preserve the narrowing.
 *
 * @public
 */
declare function createPool<T>(opts: PoolOptions<T> & {
    onOverflow: "null";
}): NullPool<T>;
/**
 * Construct a fixed-size object pool.
 *
 * @example
 * ```ts
 * import { createPool } from "aipooljs";
 *
 * interface Bullet {
 *   x: number;
 *   y: number;
 *   visible: boolean;
 *   alpha: number;
 * }
 *
 * const bullets = createPool<Bullet>({
 *   create: (): Bullet => ({ x: 0, y: 0, visible: false, alpha: 1 }),
 *   reset: (b) => {
 *     b.visible = false;
 *     b.x = 0;
 *     b.y = 0;
 *     b.alpha = 1;
 *   },
 *   size: 200,
 * });
 *
 * const b = bullets.acquire();
 * b.visible = true;
 * b.x = 100;
 * // ... use b ...
 * bullets.release(b);
 * ```
 *
 * @public
 */
declare function createPool<T>(opts: PoolOptions<T>): Pool<T>;

export { type NullPool, type OverflowHandler, type Pool, PoolDisposedError, PoolError, type PoolOptions, createPool };
