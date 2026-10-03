// AI Sprite Studio — preview viewport zoom & pan
//
// Wheel zoom about the cursor, and pan with the middle or right button (or
// Alt + left). Everything is in CSS pixels: client coordinates relative to the
// canvas, which with PixiJS autoDensity are also stage units at any resolution.

export const ZOOM = Object.freeze({ step: 1.15, min: 0.4, max: 25 });

/**
 * The next zoom level for one wheel notch.
 * @param {number} scale  Current scale.
 * @param {number} deltaY  WheelEvent.deltaY; negative zooms in.
 * @returns {number}
 */
export function nextZoomScale(scale, deltaY) {
  return deltaY < 0 ? Math.min(ZOOM.max, scale * ZOOM.step) : Math.max(ZOOM.min, scale / ZOOM.step);
}

/**
 * Re-scale a view so the world point under `point` stays under it.
 * @param {{ x: number, y: number, scale: number }} view  Current translation and (uniform) scale.
 * @param {{ x: number, y: number }} point  Screen point, CSS px relative to the canvas.
 * @param {number} scale  New scale.
 * @returns {{ x: number, y: number, scale: number }}
 */
export function zoomAround(view, point, scale) {
  const worldX = (point.x - view.x) / view.scale;
  const worldY = (point.y - view.y) / view.scale;
  return { x: point.x - worldX * scale, y: point.y - worldY * scale, scale };
}

/**
 * Attach zoom and pan to a canvas that shows `viewport` (a PIXI.Container).
 * @param {HTMLCanvasElement} canvas
 * @param {{ x: number, y: number, scale: { x: number, set: (value: number) => void } }} viewport
 * @param {AbortSignal} signal  Removes the window listener when the preview is rebuilt.
 */
export function setupViewportInteraction(canvas, viewport, signal) {
  let pan = null; // { pointerX, pointerY, viewX, viewY } while panning

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const next = zoomAround(
      { x: viewport.x, y: viewport.y, scale: viewport.scale.x },
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      nextZoomScale(viewport.scale.x, e.deltaY),
    );
    viewport.scale.set(next.scale);
    viewport.x = next.x;
    viewport.y = next.y;
  }, { passive: false });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 1 && e.button !== 2 && !e.altKey) return;
    pan = { pointerX: e.clientX, pointerY: e.clientY, viewX: viewport.x, viewY: viewport.y };
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    e.stopPropagation();
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!pan) return;
    viewport.x = pan.viewX + e.clientX - pan.pointerX;
    viewport.y = pan.viewY + e.clientY - pan.pointerY;
    e.preventDefault();
  });

  window.addEventListener('mouseup', () => {
    if (!pan) return;
    pan = null;
    canvas.style.cursor = 'default';
  }, { signal });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
