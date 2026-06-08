/**
 * Configuration for {@link createEmitter}. Controls the default error
 * policy for handlers thrown during `emit()`; per-handler
 * {@link OnOptions.captureErrors} overrides this default.
 *
 * @public
 */
interface EmitterOptions {
    /**
     * Default error policy for all handlers when they throw during emit().
     *
     *  - undefined / false (default) — first throw aborts dispatch (mitt-compatible).
     *  - true — swallow; dispatch continues over all handlers in the snapshot.
     *  - (err, type, payload) => void — invoked with the unknown error, the
     *    event name as string, and the payload as unknown. If this callback
     *    itself throws, the error is silently ignored.
     *
     * Per-subscription OnOptions.captureErrors overrides this for that handler.
     */
    captureHandlerErrors?: boolean | ((err: unknown, type: string, payload: unknown) => void);
}
/**
 * Handler invoked for a single typed event.
 *
 * @public
 */
type EventHandler<Payload> = (payload: Payload) => void;
/**
 * Handler invoked for the wildcard `"*"` subscription. Receives the actual
 * event type alongside the payload.
 *
 * @public
 */
type WildcardHandler<Events extends Record<string, unknown>> = <K extends keyof Events>(type: K, payload: Events[K]) => void;
/**
 * Subscription options accepted by {@link Emitter.on}.
 *
 * @public
 */
interface OnOptions {
    /**
     * Aborting this signal removes the handler. The same effect as calling
     * the returned unsubscribe function. Pre-aborted signals never register.
     */
    signal?: AbortSignal;
    /** Auto-remove the handler after the first dispatch. Equivalent to `once()`. */
    once?: boolean;
    /**
     * Override emitter-level captureHandlerErrors for this handler.
     *  - undefined — fall through to emitter-level.
     *  - false — force re-throw, even when emitter-level is true / callback.
     *  - true — swallow.
     *  - (err, type, payload) => void — same semantics as the emitter-level callback.
     *
     * Throws EmitterError if set on a wildcard "*" subscription.
     * @invariant does not break snapshot-before-iterate semantics.
     */
    captureErrors?: boolean | ((err: unknown, type: string, payload: unknown) => void);
    /**
     * Wildcard "*" only. Probability in (0, 1] that a dispatch reaches this
     * handler. Math.random() is sampled per dispatch. Values <= 0 or > 1 are
     * rejected at on() time.
     *
     * Throws EmitterError if set on a typed handler.
     */
    sampleRate?: number;
    /**
     * Wildcard "*" only. Minimum milliseconds between successive calls.
     * Leading-edge: the first dispatch after subscription always fires;
     * subsequent dispatches within `throttleMs` are dropped (not queued).
     * Uses Date.now(). 0 = no throttle. Negative values are rejected.
     *
     * Throws EmitterError if set on a typed handler.
     */
    throttleMs?: number;
}
/**
 * Strongly-typed event emitter. Subscribe with {@link Emitter.on} (returns
 * an unsubscribe function), dispatch with {@link Emitter.emit}, dispose
 * with {@link Emitter.dispose} when finished.
 *
 * @typeParam Events — a string-keyed map from event name to payload type.
 * @public
 */
interface Emitter<Events extends Record<string, unknown>> {
    /**
     * Subscribe to a single event type. Returns an unsubscribe function;
     * calling it (or aborting `opts.signal`) removes the handler.
     */
    on<K extends keyof Events>(type: K, handler: EventHandler<Events[K]>, opts?: OnOptions): () => void;
    /**
     * Subscribe to every event with a single handler that receives
     * `(type, payload)`. Wildcard handlers fire AFTER type-matched
     * handlers — same ordering as `mitt`.
     */
    on(type: "*", handler: WildcardHandler<Events>, opts?: OnOptions): () => void;
    /**
     * Subscribe and auto-remove after the first dispatch. Equivalent to
     * `on(type, handler, { once: true })`.
     */
    once<K extends keyof Events>(type: K, handler: EventHandler<Events[K]>): () => void;
    /**
     * Imperative unsubscribe. Prefer the unsubscribe function returned by
     * `on()` — it's faster (no reference lookup) and survives renames.
     * If `handler` is omitted, removes every handler for `type`.
     */
    off<K extends keyof Events>(type: K, handler?: EventHandler<Events[K]>): void;
    /**
     * Imperative wildcard unsubscribe.
     */
    off(type: "*", handler?: WildcardHandler<Events>): void;
    /**
     * Dispatch synchronously. Handlers receive `payload`; wildcard handlers
     * receive `(type, payload)`. Handler lists are snapshotted before iteration,
     * so removing a handler inside its own callback does not skip subsequent
     * handlers. By default, the first throwing handler aborts the dispatch;
     * set EmitterOptions.captureHandlerErrors (or per-handler OnOptions.captureErrors)
     * to swallow or report errors and continue.
     */
    emit<K extends keyof Events>(type: K, payload: Events[K]): void;
    /**
     * Remove every handler for every event (including wildcards). The
     * emitter remains usable. Use {@link dispose} for permanent teardown.
     */
    clear(): void;
    /**
     * Idempotent teardown. Drops every handler; subsequent `on` / `once` /
     * `emit` / `off` / `clear` throw {@link EmitterDisposedError}.
     */
    dispose(): void;
    /** `true` once {@link dispose} has been called. */
    readonly disposed: boolean;
}
/**
 * Recoverable emitter error. Thrown by `on()` when `OnOptions` violates a
 * precondition: `captureErrors` set on a wildcard `"*"` subscription;
 * `sampleRate` / `throttleMs` set on a typed subscription; `sampleRate`
 * outside `(0, 1]`; or `throttleMs` negative.
 *
 * @public
 */
declare class EmitterError extends Error {
    readonly name = "EmitterError";
}
/**
 * Thrown by any emitter method called after {@link Emitter.dispose}.
 *
 * @public
 */
declare class EmitterDisposedError extends Error {
    readonly name = "EmitterDisposedError";
}
/**
 * Construct a strongly-typed event emitter.
 *
 * @example
 * ```ts
 * import { createEmitter } from "aieventjs";
 *
 * type Events = {
 *   "user:login": { id: string };
 *   "user:logout": void;
 * };
 *
 * const bus = createEmitter<Events>();
 *
 * const off = bus.on("user:login", (u) => console.log("hi", u.id));
 * bus.emit("user:login", { id: "alice" });
 * off();
 *
 * bus.on("*", (type, payload) => console.log("event", type, payload));
 * ```
 *
 * @public
 */
declare function createEmitter<Events extends Record<string, unknown> = Record<string, unknown>>(opts?: EmitterOptions): Emitter<Events>;

export { type Emitter, EmitterDisposedError, EmitterError, type EmitterOptions, type EventHandler, type OnOptions, type WildcardHandler, createEmitter };
