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
function isValidEnvelope(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value;
  if (typeof v.timestamp !== "number" || !Number.isFinite(v.timestamp)) return false;
  switch (v.kind) {
    case "request":
      return typeof v.id === "string" && v.id.length > 0 && typeof v.method === "string" && v.method.length > 0;
    case "response":
      return typeof v.id === "string" && v.id.length > 0 && typeof v.ok === "boolean";
    case "event":
      return typeof v.event === "string" && v.event.length > 0;
    default:
      return false;
  }
}
function generateId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.random() * 16 | 0;
    const v = ch === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
function now() {
  return Date.now();
}

export { BridgeDisposedError, BridgeError, BridgeRemoteError, BridgeResetError, BridgeTimeoutError, generateId, isValidEnvelope, now };
//# sourceMappingURL=chunk-4SMOCFWS.js.map
//# sourceMappingURL=chunk-4SMOCFWS.js.map