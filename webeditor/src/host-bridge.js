import { createBridge } from 'aibridgejs';
import { createIframeAdapter } from 'aibridgejs/iframe';

const ASSET_ID = /^[A-Za-z0-9_-]{1,80}$/;
const COMMAND_TYPES = new Set(['reload-assets', 'request-context', 'select-asset']);
// aibridgejs 0.6.0 leaves emit() unbounded unless each call passes timeoutMs.
const EMIT_TIMEOUT_MS = 5000;

export function normaliseStudioCommand(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.type !== 'string' || !COMMAND_TYPES.has(value.type)) return null;
  if (value.type === 'select-asset') {
    return typeof value.asset === 'string' && ASSET_ID.test(value.asset)
      ? { type: value.type, asset: value.asset }
      : null;
  }
  return { type: value.type };
}

/**
 * Allowlist for the bridge target: only a parent on this page's own origin.
 * islumina.org embeds a synced copy of this directory and local embedding is
 * same-origin too, so nothing else needs to be trusted. Reading a cross-origin
 * parent's location throws, which also maps to null.
 * @param {string} ownOrigin  `window.location.origin`.
 * @param {() => string} readParentOrigin  Reads `window.parent.location.origin`.
 * @returns {string|null} The origin to talk to, or null to disable the bridge.
 */
export function allowedParentOrigin(ownOrigin, readParentOrigin) {
  if (!ownOrigin || ownOrigin === 'null') return null;
  try {
    return readParentOrigin() === ownOrigin ? ownOrigin : null;
  } catch {
    return null;
  }
}

function parentOrigin() {
  if (typeof window === 'undefined' || window.parent === window) return null;
  return allowedParentOrigin(window.location.origin, () => window.parent.location.origin);
}

/** The iframe adapter to a same-origin parent, or null when the editor is not embedded by one. */
function parentAdapter() {
  const targetOrigin = parentOrigin();
  if (!targetOrigin) return null;
  return createIframeAdapter(window, {
    targetOrigin,
    postTarget: window.parent,
    expectedSource: window.parent,
  });
}

/**
 * Talk to the embedding page: announce ready / context / error, and accept validated commands.
 * @param {{ onCommand?: (command: { type: string, asset?: string }) => void, adapter?: import('aibridgejs').BridgeAdapter | null }} [options]
 *   `adapter` defaults to the iframe adapter for a same-origin parent; tests pass aibridgejs/mock.
 * @returns {{ ready: Function, context: Function, error: Function, dispose: () => void } | null}  null when there is no host.
 */
export function createStudioHostBridge({ onCommand, adapter = parentAdapter() } = {}) {
  if (!adapter) return null;

  const bridge = createBridge({ adapter, timeoutMs: EMIT_TIMEOUT_MS });
  const unsubscribe = bridge.on('studio/command', (payload) => {
    const command = normaliseStudioCommand(payload);
    if (command) onCommand?.(command);
  });

  async function emit(event, payload) {
    try {
      await bridge.emit(event, payload, { timeoutMs: EMIT_TIMEOUT_MS });
    } catch (error) {
      console.warn(`Host bridge ${event} failed:`, error);
    }
  }

  return {
    ready: (payload) => emit('studio/ready', payload),
    context: (payload) => emit('studio/context', payload),
    error: (payload) => emit('studio/error', payload),
    dispose() {
      unsubscribe();
      bridge.dispose();
    },
  };
}
