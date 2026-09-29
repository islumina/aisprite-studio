type BridgePlatform = "iframe" | "flutter" | "mock" | "unknown";
type RequestEnvelope = {
    kind: "request";
    id: string;
    method: string;
    payload?: unknown;
    timestamp: number;
};
type ResponseEnvelope = {
    kind: "response";
    id: string;
    ok: boolean;
    payload?: unknown;
    error?: {
        code: string;
        message: string;
        detail?: unknown;
    };
    timestamp: number;
};
type EventEnvelope = {
    kind: "event";
    event: string;
    payload?: unknown;
    timestamp: number;
};
type BridgeEnvelope = RequestEnvelope | ResponseEnvelope | EventEnvelope;
type BridgeListener<T = unknown> = (payload: T) => void;
type SubscribeMeta = {
    origin?: string;
    source?: unknown;
};
interface BridgeAdapter {
    readonly platform: BridgePlatform;
    /**
     * Resolve once the transport can carry messages.
     *
     * The signal passed to `ready()` is per readiness round; it aborts on
     * `reset()` (reason `BridgeResetError`) and `dispose()` (reason
     * `BridgeDisposedError`). Adapters must detach their listeners on abort.
     */
    ready(signal?: AbortSignal): Promise<void>;
    post(message: BridgeEnvelope): Promise<void>;
    subscribe(listener: (message: BridgeEnvelope, meta?: SubscribeMeta) => void, options?: {
        signal?: AbortSignal;
    }): () => void;
    dispose(): void;
}
interface CallOptions {
    /**
     * Per-call deadline in ms, defaulting to the bridge's `timeoutMs` (10 s).
     *
     * `timeoutMs` is measured from `call()` entry and covers the readiness wait,
     * `adapter.post()` and the response wait. Once elapsed the call rejects with
     * `BridgeTimeoutError`. `<= 0` or `Infinity` arms no timer (pair it with
     * `signal`); `NaN` falls back to the default; values above 2,147,483,647
     * are clamped to it.
     */
    timeoutMs?: number;
    /** Abort a single call (its readiness wait, post or response wait). */
    signal?: AbortSignal;
}
interface EmitOptions {
    /**
     * Per-call deadline for the readiness wait + adapter `post()`, in ms,
     * measured from `emit()` entry.
     *
     * Unlike {@link CallOptions.timeoutMs}, this is opt-in only: when omitted
     * `emit()` arms NO timer. It is then unbounded but reclaimable: it waits for
     * readiness and `post()` with no time bound, and only `reset()`
     * (`BridgeResetError`) or `dispose()` (`BridgeDisposedError`) settle it
     * early. A positive value rejects with `BridgeTimeoutError` once elapsed; a
     * non-positive value (`<= 0`) explicitly disables the timer — pair it with
     * `signal` if the adapter may hang.
     */
    timeoutMs?: number;
    /**
     * Abort a single in-flight `emit()` (its readiness wait or `post()`) without
     * resetting / disposing the whole bridge. Rejects with the signal's reason.
     */
    signal?: AbortSignal;
}
interface OnOptions {
    signal?: AbortSignal;
    once?: boolean;
}
interface ReadyOptions {
    signal?: AbortSignal;
}
interface Bridge {
    ready(options?: ReadyOptions): Promise<void>;
    call<T = unknown>(method: string, payload?: unknown, options?: CallOptions): Promise<T>;
    emit(event: string, payload?: unknown, options?: EmitOptions): Promise<void>;
    on<T = unknown>(event: string, listener: BridgeListener<T>, options?: OnOptions): () => void;
    platform(): BridgePlatform;
    /**
     * Reject pending `call()`s and in-flight `emit()`s with `BridgeResetError`,
     * cancel the current readiness round, and forget cached readiness so the
     * next `ready()`/`call()`/`emit()` re-awaits `adapter.ready()`. Registered
     * `on()` listeners and the adapter subscription are untouched; only
     * `dispose()` removes them.
     */
    reset(): void;
    /** Permanent, idempotent teardown: rejects in-flight work with `BridgeDisposedError` and removes every listener. */
    dispose(): void;
}
interface BridgeOptions {
    adapter: BridgeAdapter;
    timeoutMs?: number;
}

export type { Bridge as B, CallOptions as C, EmitOptions as E, OnOptions as O, ReadyOptions as R, SubscribeMeta as S, BridgeAdapter as a, BridgeEnvelope as b, BridgeListener as c, BridgeOptions as d, BridgePlatform as e, EventEnvelope as f, RequestEnvelope as g, ResponseEnvelope as h };
