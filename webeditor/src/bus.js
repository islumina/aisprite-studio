// AI Sprite Studio — central event bus (aieventjs)
//
// One typed emitter decouples the panels: the JSON model emits `atlas:changed`,
// the preview re-renders, and the pivot crosshair reports drags. Keeping every
// cross-panel signal here means a panel never reaches into another panel's
// internals — it just publishes a fact.
import { createEmitter } from 'aieventjs';

/**
 * @typedef {Object} BusEvents
 * @property {{ reason: string }}       atlas:changed  The atlas object was mutated; consumers re-read it.
 * @property {{ x: number, y: number }} anchor:drag    The pivot crosshair moved (every pointermove while dragging).
 * @property {{ x: number, y: number }} anchor:drop    The pivot drag ended at this anchor.
 */

/**
 * Handler errors are captured and logged, so one throwing panel cannot stop the
 * others from seeing an event (aieventjs aborts dispatch on the first throw by default).
 * @type {import('aieventjs').Emitter<BusEvents>}
 */
export const bus = createEmitter({
  captureHandlerErrors: (error, type) => console.error(`Bus handler for "${type}" failed:`, error),
});

// Stable event-name constants so a typo fails loudly at import time, not silently at runtime.
export const EV = {
  ATLAS_CHANGED: 'atlas:changed',
  ANCHOR_DRAG: 'anchor:drag',
  ANCHOR_DROP: 'anchor:drop',
};
