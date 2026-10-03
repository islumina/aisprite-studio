// AI Sprite Studio — shared editor defaults
//
// One place for the fallbacks and tuning values more than one module relies on,
// so the panels cannot drift apart.

/** Minimum ms between anchor writes while the pivot is dragged (each write rewrites every frame of the clip). */
export const ANCHOR_DRAG_THROTTLE_MS = 50;

/** Anchor for a frame without one: the image centre (what the pipeline and PixiJS use). */
export const DEFAULT_ANCHOR = Object.freeze({ x: 0.5, y: 0.5 });

/** Untrimmed frame size for a frame without `sourceSize`. */
export const DEFAULT_SOURCE_SIZE = Object.freeze({ w: 256, h: 256 });

/** Duration (ms) of a frame without `duration` when the atlas sets no `defaultFrameDuration`; the animator gets the same value. */
export const DEFAULT_FRAME_DURATION_MS = 125;

/**
 * Parse an anchor field, falling back for anything that is not a finite number (0 is valid).
 * @param {string} text
 * @param {number} fallback
 */
export function parseAnchorValue(text, fallback) {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}
