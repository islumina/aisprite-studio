// AIPLAYBOOK — central event bus (aieventjs)
//
// One typed emitter decouples the panels: the JSON model emits `atlas:changed`,
// the preview re-renders, the T-Pose panel reacts to focus, and the toolbar
// requests asset reloads. Keeping every cross-panel signal here means a panel
// never reaches into another panel's internals — it just publishes a fact.
import { createEmitter } from 'aieventjs';

/**
 * @typedef {Object} BusEvents
 * @property {{ reason: string }} atlas:changed   The atlas object was mutated; consumers re-read it.
 * @property {{ name: string }}   unit:select     A playable unit (state or object animation) was chosen.
 * @property {{ id: string }}     pose:focus      A T-Pose thumbnail was clicked; highlight its derived actions.
 * @property {{ id: string, enabled: boolean }} pose:toggle  A T-Pose `enabled` flag was flipped.
 * @property {{}}                 assets:reload   Re-fetch the frame image from disk (Antigravity regenerated it).
 */

/** @type {import('aieventjs').Emitter<BusEvents>} */
export const bus = createEmitter();

// Stable event-name constants so a typo fails loudly at import time, not silently at runtime.
export const EV = {
  ATLAS_CHANGED: 'atlas:changed',
  UNIT_SELECT: 'unit:select',
  POSE_FOCUS: 'pose:focus',
  POSE_TOGGLE: 'pose:toggle',
  ASSETS_RELOAD: 'assets:reload',
  ANCHOR_DRAGGED: 'anchor_dragged',
};
