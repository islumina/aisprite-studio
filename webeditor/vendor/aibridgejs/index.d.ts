import { d as BridgeOptions, B as Bridge } from './types-CoeBJjfk.js';
export { a as BridgeAdapter, b as BridgeEnvelope, c as BridgeListener, e as BridgePlatform, C as CallOptions, E as EmitOptions, f as EventEnvelope, O as OnOptions, R as ReadyOptions, g as RequestEnvelope, h as ResponseEnvelope, S as SubscribeMeta } from './types-CoeBJjfk.js';

declare function createBridge(options: BridgeOptions): Bridge;

declare class BridgeError extends Error {
    constructor(message: string);
}
declare class BridgeDisposedError extends BridgeError {
    constructor(message?: string);
}
declare class BridgeResetError extends BridgeError {
    constructor(message?: string);
}
declare class BridgeTimeoutError extends BridgeError {
    constructor(message?: string);
}
declare class BridgeRemoteError extends BridgeError {
    readonly code: string;
    readonly detail: unknown;
    constructor(message: string, code: string, detail?: unknown);
}

export { Bridge, BridgeDisposedError, BridgeError, BridgeOptions, BridgeRemoteError, BridgeResetError, BridgeTimeoutError, createBridge };
