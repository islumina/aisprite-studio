import { createBridge } from 'aibridgejs';
import { createIframeAdapter } from 'aibridgejs/iframe';

const ASSET_ID = /^[A-Za-z0-9_-]{1,80}$/;
const COMMAND_TYPES = new Set(['reload-assets', 'request-context', 'select-asset']);

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

function parentOrigin() {
  if (typeof window === 'undefined' || window.parent === window || !document.referrer) return null;
  try {
    const origin = new URL(document.referrer).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

export function createStudioHostBridge({ onCommand } = {}) {
  const targetOrigin = parentOrigin();
  if (!targetOrigin) return null;

  const bridge = createBridge({
    adapter: createIframeAdapter(window, {
      targetOrigin,
      postTarget: window.parent,
      expectedSource: window.parent,
    }),
    timeoutMs: 5000,
  });
  const unsubscribe = bridge.on('studio/command', (payload) => {
    const command = normaliseStudioCommand(payload);
    if (command) onCommand?.(command);
  });

  async function emit(event, payload) {
    try {
      await bridge.emit(event, payload, { timeoutMs: 5000 });
    } catch (error) {
      console.warn(`Host bridge ${event} failed:`, error);
    }
  }

  return {
    ready: (payload) => emit('studio/ready', payload),
    context: (payload) => emit('studio/context', payload),
    dispose() {
      unsubscribe();
      bridge.dispose();
    },
  };
}
