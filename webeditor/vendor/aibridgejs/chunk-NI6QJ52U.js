// src/errors.ts
var BridgeError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "BridgeError";
  }
};
var BridgeDisposedError = class extends BridgeError {
  constructor(message = "Bridge has been disposed") {
    super(message);
    this.name = "BridgeDisposedError";
  }
};
var BridgeResetError = class extends BridgeError {
  constructor(message = "Bridge has been reset") {
    super(message);
    this.name = "BridgeResetError";
  }
};
var BridgeTimeoutError = class extends BridgeError {
  constructor(message = "Bridge call timed out") {
    super(message);
    this.name = "BridgeTimeoutError";
  }
};
var BridgeRemoteError = class extends BridgeError {
  code;
  detail;
  constructor(message, code, detail) {
    super(message);
    this.name = "BridgeRemoteError";
    this.code = code;
    this.detail = detail;
  }
};

// src/internal.ts
function isObject(value) {
  return typeof value === "object" && value !== null;
}
function invalid(subject, constraint) {
  throw new BridgeError(`aibridgejs: ${subject} must be ${constraint}`);
}
function assertHost(host) {
  const h = host;
  if (!isObject(h) || typeof h.addEventListener !== "function" || typeof h.removeEventListener !== "function") {
    invalid("host", "an object with addEventListener and removeEventListener functions");
  }
}
function isValidEnvelope(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value;
  try {
    const timestamp = v.timestamp;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return false;
    switch (v.kind) {
      case "request": {
        const id = v.id;
        const method = v.method;
        return typeof id === "string" && id.length > 0 && typeof method === "string" && method.length > 0;
      }
      case "response": {
        const id = v.id;
        const ok = v.ok;
        return typeof id === "string" && id.length > 0 && typeof ok === "boolean";
      }
      case "event": {
        const event = v.event;
        return typeof event === "string" && event.length > 0;
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

export { BridgeDisposedError, BridgeError, BridgeRemoteError, BridgeResetError, BridgeTimeoutError, assertHost, invalid, isObject, isValidEnvelope };
//# sourceMappingURL=chunk-NI6QJ52U.js.map
//# sourceMappingURL=chunk-NI6QJ52U.js.map