import { FlutterAdapterOptions } from '../flutter/index.js';
import { IframeAdapterOptions } from '../iframe/index.js';
import { a as BridgeAdapter } from '../types-CoeBJjfk.js';

interface DetectOptions {
    iframe?: IframeAdapterOptions;
    flutter?: FlutterAdapterOptions;
}
type ListenerFn = (...args: never[]) => void;
interface DetectHost {
    flutter_inappwebview?: {
        callHandler?: unknown;
    };
    parent?: unknown;
    addEventListener?: ListenerFn;
    removeEventListener?: ListenerFn;
}
/**
 * Auto-detect and create the most appropriate bridge adapter.
 *
 * Pure-web safety: `pure-web safe (auto-fallback)` — falls back to mock when no shell is detected.
 *
 * See [STABILITY.md](../STABILITY.md) for the full per-subpath safety table.
 */
declare function detectBridgeAdapter(host: DetectHost, options?: DetectOptions): BridgeAdapter;

export { type DetectOptions, detectBridgeAdapter };
