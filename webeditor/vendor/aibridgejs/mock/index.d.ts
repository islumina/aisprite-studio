import { a as BridgeAdapter, b as BridgeEnvelope } from '../types-CoeBJjfk.js';

interface MockAdapter extends BridgeAdapter {
    readonly platform: "mock";
    receive(envelope: BridgeEnvelope): void;
}
/**
 * Create a mock bridge adapter.
 *
 * Pure-web safety: `dev only` — in-memory loopback; not for production traffic.
 *
 * See [STABILITY.md](../STABILITY.md) for the full per-subpath safety table.
 */
declare function createMockAdapter(): MockAdapter;

export { type MockAdapter, createMockAdapter };
