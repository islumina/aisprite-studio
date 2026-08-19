import { createMockAdapter } from '../chunk-5BCYYEYS.js';
import { createIframeAdapter } from '../chunk-XOKQHATZ.js';
import { createFlutterAdapter } from '../chunk-GGEUIZTM.js';
import '../chunk-4SMOCFWS.js';

// src/detect/index.ts
function detectBridgeAdapter(host, options = {}) {
  if (host?.flutter_inappwebview?.callHandler && typeof host.addEventListener === "function" && typeof host.removeEventListener === "function") {
    return createFlutterAdapter(host, options.flutter);
  }
  if (host?.parent && host.parent !== host) {
    if (!options.iframe || !options.iframe.targetOrigin) {
      throw new Error(
        "detectBridgeAdapter: iframe host detected but options.iframe.targetOrigin is missing"
      );
    }
    return createIframeAdapter(host, options.iframe);
  }
  return createMockAdapter();
}

export { detectBridgeAdapter };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map