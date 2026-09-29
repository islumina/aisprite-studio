import { createMockAdapter } from '../chunk-PZPVI5NN.js';
import { createIframeAdapter } from '../chunk-OITYZ3SI.js';
import { createFlutterAdapter } from '../chunk-X766BQVN.js';
import { isObject, invalid } from '../chunk-NI6QJ52U.js';

// src/detect/index.ts
function detectBridgeAdapter(host, options = {}) {
  if (!isObject(options)) invalid("options", "an object");
  if (host?.flutter_inappwebview?.callHandler && typeof host.addEventListener === "function" && typeof host.removeEventListener === "function") {
    return createFlutterAdapter(host, options.flutter);
  }
  if (host?.parent && host.parent !== host) {
    return createIframeAdapter(host, options.iframe);
  }
  return createMockAdapter();
}

export { detectBridgeAdapter };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map