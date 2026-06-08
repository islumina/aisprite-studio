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
 *   the alive set and handed to the caller. **Warning:** if the handler recycles
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
     * Factory invoked exactly `size` times at construction. Each invocation
     * must return a fresh instance — pool semantics depend on independence
     * between slots.
     *
     * If `create()` throws, {@link createPool} throws and no slots are kept.
     */
    create: () => T;
    /**
     * Reset hook called on every {@link Pool.release}. Must clear mutable
     * fields back to a known good state without `delete`-ing properties:
     * deleting fields demotes V8 hidden classes and turns the steady-state
     * loop megamorphic.
     *
     * Prefer `obj.x = 0; obj.visible = false;` over `delete obj.x`.
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
     * pooled objects. Subsequent calls to `acquire` / `release` / `drain`
     * throw {@link PoolDisposedError}.
     */
    dispose(): void;
    /**
     * Acquire an object, call `fn(obj)`, then release automatically via
     * `try/finally`. Both sync and async `fn` are supported.
     *
     * **Invariants:**
     * 1. `release(obj)` is guaranteed to run in `finally` — on sync throw,
     *    async reject, or abort.
     * 2. If `opts.signal` is aborted before or during `fn`, `borrow` releases
     *    the slot immediately and rejects with `signal.reason` (default:
     *    `AbortError` DOMException). If the signal is already aborted before
     *    `borrow` is called, the promise rejects without acquiring or calling
     *    `fn`.
     * 3. Abort does **not** cancel inner work — `fn` keeps running; `signal` is
     *    advisory. See **INV6** below.
     * 4. If the pool is disposed, `borrow` throws `PoolDisposedError`
     *    synchronously, before `acquire` or `fn`.
     * 5. If `onOverflow` is `'null'` and the pool is full, `borrow` throws
     *    `PoolError` synchronously; `fn` is never called.
     * 6. **Abort does not fence inner work.** When `signal` aborts, `borrow`
     *    releases the slot and rejects immediately. It does **not** cancel the
     *    work inside `fn` — the signal is advisory. If `fn` keeps touching the
     *    borrowed object after abort, it may mutate an object another caller has
     *    since acquired. `fn` must observe `signal.aborted` and stop touching
     *    the object the moment it aborts. Treat the borrowed object as invalid
     *    once `signal` fires.
     * 7. **Dispose-during-borrow:** if `dispose()` is called while an async
     *    `borrow` is in flight, the `finally` block runs `release(obj)` after
     *    the pool is already disposed — `release` throws `PoolDisposedError`,
     *    which surfaces from the `finally` block and **masks** whatever `fn`
     *    returned or threw. The caller will always see a `PoolDisposedError` in
     *    this race, regardless of `fn`'s outcome. This is an explicit invariant:
     *    do not dispose a pool that has active borrows.
     *
     * **Sync vs async dispatch:** disposed/overflow errors are thrown
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
 * Recoverable pool error. Thrown by `acquire()` on overflow and by
 * `release()` on double-release or foreign-object release.
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
