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
    ready(signal?: AbortSignal): Promise<void>;
    post(message: BridgeEnvelope): Promise<void>;
    subscribe(listener: (message: BridgeEnvelope, meta?: SubscribeMeta) => void, options?: {
        signal?: AbortSignal;
    }): () => void;
    dispose(): void;
}
interface CallOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
}
interface EmitOptions {
    /**
     * Per-call deadline for the readiness wait + adapter `post()`, in ms.
     *
     * Unlike {@link CallOptions.timeoutMs}, this is opt-in only: when omitted
     * `emit()` arms NO timer and keeps the pre-existing fire-and-forget contract
     * (it waits for readiness and `post()` with no time bound). A positive value
     * rejects with `BridgeTimeoutError` once elapsed; a non-positive value
     * (`<= 0`) explicitly disables the timer — pair it with `signal` if the
     * adapter may hang.
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
    reset(): void;
    dispose(): void;
}
interface BridgeOptions {
    adapter: BridgeAdapter;
    timeoutMs?: number;
}

export type { Bridge as B, CallOptions as C, EmitOptions as E, OnOptions as O, ReadyOptions as R, SubscribeMeta as S, BridgeAdapter as a, BridgeEnvelope as b, BridgeListener as c, BridgeOptions as d, BridgePlatform as e, EventEnvelope as f, RequestEnvelope as g, ResponseEnvelope as h };
