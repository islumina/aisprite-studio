import { a as BridgeAdapter } from '../types-CoeBJjfk.js';

interface IframePostTarget {
    postMessage(message: unknown, targetOrigin: string): void;
}
interface IframeHost {
    addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
    removeEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
}
interface MessageEventLike {
    readonly data: unknown;
    readonly origin: string;
    readonly source: unknown;
}
interface IframeAdapterOptions {
    targetOrigin: string;
    postTarget?: IframePostTarget;
    expectedSource?: unknown;
}
interface IframeAdapter extends BridgeAdapter {
    readonly platform: "iframe";
    /** @internal Test-only helper. Not part of the public contract. */
    dispatchTestMessage(envelope: unknown, meta: {
        origin: string;
        source?: unknown;
    }): void;
}
/**
 * Create an iframe bridge adapter.
 *
 * Pure-web safety: `pure-web safe` — pure postMessage API; requires exact targetOrigin (wildcard rejected).
 *
 * See [STABILITY.md](../STABILITY.md) for the full per-subpath safety table.
 *
 * **Security baseline — origin allowlisting:**
 * Every inbound message is checked against `targetOrigin`; messages from any
 * other origin are silently discarded. Exact-origin allowlisting is the
 * primary security gate and cannot be disabled.
 *
 * **`event.source` check — defense-in-depth:**
 * When `expectedSource` is a non-null value the adapter additionally verifies
 * that `event.source` matches exactly, providing a second layer of protection
 * against same-origin pages that share the targetOrigin. This check is
 * defense-in-depth: it can be disabled by passing `expectedSource: null`, in
 * which case only the origin is validated.
 *
 * **Default `expectedSource` derivation:**
 * - If `options.postTarget` is provided, `expectedSource` defaults to that
 *   same object (the target you post to is the source you trust).
 * - If no `postTarget` is given, the adapter tries to infer one from
 *   `host.parent` or `host` itself. If inference succeeds the inferred target
 *   becomes the default `expectedSource`.
 * - If inference fails (no parent, no `postMessage` on host), `expectedSource`
 *   defaults to `null` — origin-only validation applies. Callers in this
 *   configuration accept messages from any `event.source` as long as the
 *   origin matches. This is the safe fallback; pass an explicit
 *   `expectedSource` to re-enable the source check.
 */
declare function createIframeAdapter(host: IframeHost, options: IframeAdapterOptions): IframeAdapter;

export { type IframeAdapter, type IframeAdapterOptions, type IframeHost, type IframePostTarget, type MessageEventLike, createIframeAdapter };
