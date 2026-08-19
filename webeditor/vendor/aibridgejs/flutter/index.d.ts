import { a as BridgeAdapter, b as BridgeEnvelope } from '../types-BuGIzhu1.js';

interface FlutterInAppWebView {
    callHandler(name: string, ...args: unknown[]): Promise<unknown>;
}
interface FlutterHost {
    flutter_inappwebview?: FlutterInAppWebView;
    addEventListener(type: string, listener: () => void, options?: {
        once?: boolean;
    }): void;
    removeEventListener(type: string, listener: () => void): void;
}
interface FlutterAdapterOptions {
    handlerName?: string;
    waitForReadyEvent?: boolean;
    readyEventName?: string;
}
interface FlutterAdapter extends BridgeAdapter {
    readonly platform: "flutter";
    receive(envelope: BridgeEnvelope): void;
}
/**
 * Create a Flutter bridge adapter.
 *
 * Pure-web safety: `requires native shell` — needs `host.flutter_inappwebview.callHandler`.
 *
 * See [STABILITY.md](../STABILITY.md) for the full per-subpath safety table.
 */
declare function createFlutterAdapter(host: FlutterHost, options?: FlutterAdapterOptions): FlutterAdapter;

export { type FlutterAdapter, type FlutterAdapterOptions, type FlutterHost, type FlutterInAppWebView, createFlutterAdapter };
