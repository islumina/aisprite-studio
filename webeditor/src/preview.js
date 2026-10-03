// AI Sprite Studio — PixiJS preview surface
//
// Uses PixiJS Spritesheet class for correct trim/anchor handling.
// Sprites are rendered with proper sourceSize padding and spriteSourceSize offsets.
// The aispritejs animator (runtime.js) is the playback clock: every ticker frame
// asks the clock set with setClock() which frame to show. The AnimatedSprite only
// holds the current clip's textures; it never plays on its own, and the frame
// inspector steps it with gotoAndStop() while playback is paused (aispritejs has
// no seek API).
import * as PIXI from 'pixi.js';
import { bus, EV } from './bus.js';
import { keyGreen } from './chroma.js';

let app = null;
let sprite = null;
let crosshairEl = null;
const canvasSize = 512; // fallback source frame size when an atlas omits sourceSize
let currentPb = null;
let _sheet = null; // current parsed Spritesheet instance
// Green-screen key: generation uses solid #00FF00, keyed to transparency at load.
let _chroma = { enabled: true, similarity: 0.30, smoothness: 0.10, key: [0, 255, 0] };
let _keyedCanvas = null; // last keyed sheet canvas (for "Export keyed PNG")
let prevSprite = null;
let nextSprite = null;
let _onionEnabled = false;

// Viewport zoom & pan, and interactive pivot graphics
let viewport = null;
let pivotGraphics = null;
let draggingPivot = false;
let dragAnchor = null; // last anchor reported during the current pivot drag
let hostObserver = null; // keeps the renderer the size of its host element
const dragPoint = new PIXI.Point(); // reused out-parameter for toLocal() on every pointermove

export function setChroma(opts) { _chroma = { ..._chroma, ...opts }; }
export function getChroma() { return { ..._chroma }; }
export function getKeyedCanvas() { return _keyedCanvas; }

async function loadBitmap(url) {
  const blob = await (await fetch(url)).blob();
  return await createImageBitmap(blob);
}

/** Draw a premium glowing crosshair for pivot anchor. */
function drawPivotCrosshair(g) {
  g.clear();
  const color = 0xec4899;
  // Outer circle (accent color)
  g.circle(0, 0, 10).stroke({ width: 2.5, color: color });
  // Center dot
  g.circle(0, 0, 3).fill(color);
  // Cross hair lines (drawn via filled rectangles to ensure visibility at all scales)
  g.rect(-24, -1, 48, 2).fill(color);
  g.rect(-1, -24, 2, 48).fill(color);

  g.hitArea = new PIXI.Circle(0, 0, 25);
}

/** Create the PixiJS app inside `container`; idempotent-safe. */
export async function initPreview(container, crosshair) {
  hostObserver?.disconnect();
  hostObserver = null;
  if (app) {
    app.destroy(
      { removeView: true, releaseGlobalResources: true },
      { children: true, texture: true, textureSource: true }
    );
  }
  app = new PIXI.Application();

  // The canvas is absolutely positioned inside `container` (style.css), so the
  // container's size comes from the layout alone and the canvas follows it.
  const vw = container.clientWidth || 512;
  const vh = container.clientHeight || 512;
  try {
    await app.init({ width: vw, height: vh, backgroundAlpha: 0, antialias: true });
  } catch (error) {
    app = null; // keep every other export a no-op instead of touching a half-built app
    throw new Error(`PixiJS renderer failed to initialise: ${error?.message ?? error}`, { cause: error });
  }
  container.querySelector('canvas')?.remove();
  container.appendChild(app.canvas);
  crosshairEl = crosshair;

  // Initialize viewport container
  viewport = new PIXI.Container();
  app.stage.addChild(viewport);

  sprite = new PIXI.AnimatedSprite([PIXI.Texture.EMPTY]);
  sprite.x = vw / 2;
  sprite.y = vh * 0.65;

  prevSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
  nextSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
  prevSprite.alpha = 0.22;
  nextSprite.alpha = 0.22;
  prevSprite.tint = 0xff8888;
  nextSprite.tint = 0x8888ff;

  // Initialize interactive pivot crosshair
  pivotGraphics = new PIXI.Graphics();
  drawPivotCrosshair(pivotGraphics);
  pivotGraphics.visible = false;
  pivotGraphics.eventMode = 'static';
  pivotGraphics.cursor = 'pointer';

  // Add all children into viewport
  viewport.addChild(prevSprite);
  viewport.addChild(nextSprite);
  viewport.addChild(sprite);
  viewport.addChild(pivotGraphics);

  // Setup interactions
  setupViewportInteraction(app.canvas);
  setupPivotDrag();
  app.ticker.add(advanceClock);

  // Follow the host: window resizes, the viewer-mode breakpoint, and layout changes
  // that fire no window resize. Zoom and pan (the viewport transform) are kept.
  hostObserver = new ResizeObserver(() => resizeToHost(container));
  hostObserver.observe(container);
}

/** Match the renderer to its host element and re-fit the sprite. */
function resizeToHost(container) {
  if (!app) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w === 0 || h === 0) return; // hidden or not laid out yet
  if (w === app.renderer.width && h === app.renderer.height) return;
  app.renderer.resize(w, h);
  layoutSprite();
  app.render(); // resizing clears the canvas; draw now rather than show a blank frame
}

/** Centre the sprite and fit its source frame to ~55% of the renderer. */
function layoutSprite() {
  if (!sprite || !app) return;
  const rw = app.renderer.width;
  const rh = app.renderer.height;
  sprite.x = rw / 2;
  sprite.y = rh * 0.65;
  if (!currentPb) return;
  // sourceSize is the original untrimmed frame size (e.g. 512x512)
  const sourceH = currentPb.sourceSize?.h || canvasSize;
  const sourceW = currentPb.sourceSize?.w || canvasSize;
  const fitScale = Math.min((rh * 0.55) / sourceH, (rw * 0.55) / sourceW);
  sprite.scale.set(fitScale, fitScale);
  updateOnionSkin();
  positionCrosshair(currentPb.anchor);
}

/**
 * Load a spritesheet via PixiJS Assets — handles trim, sourceSize, anchor automatically.
 * @param {string} imageUrl - path to the sheet PNG
 * @param {object} atlasData - parsed atlas.json object
 */
export async function loadSheet(imageUrl, atlasData) {
  // Stop animation and reset active sprite textures before destroying them
  if (sprite) {
    sprite.stop();
    sprite.textures = [PIXI.Texture.EMPTY];
  }
  if (prevSprite) prevSprite.texture = PIXI.Texture.EMPTY;
  if (nextSprite) nextSprite.texture = PIXI.Texture.EMPTY;

  // Clean up previous sheet from cache to avoid stale textures
  if (_sheet) {
    _sheet.destroy(true); // destroyBaseTexture = true
    _sheet = null;
  }
  // Bust cache for hot-reload
  // Query strings corrupt data URLs. Hosted/demo sheets are generated in-memory,
  // while file-backed sheets still need cache busting for regeneration previews.
  const bustUrl = /^(data:|blob:)/.test(imageUrl)
    ? imageUrl
    : imageUrl + (imageUrl.includes('?') ? '&' : '?') + `_t=${Date.now()}`;

  let baseTexture;
  if (_chroma.enabled) {
    // Key #00FF00 → transparent on a canvas, then build the sheet from that.
    const bmp = await loadBitmap(bustUrl);
    _keyedCanvas = keyGreen(bmp, _chroma);
    baseTexture = PIXI.Texture.from(_keyedCanvas);
  } else {
    _keyedCanvas = null;
    baseTexture = await PIXI.Assets.load({ src: bustUrl, parser: 'texture' });
  }

  _sheet = new PIXI.Spritesheet({
    texture: baseTexture,
    data: atlasData,
  });
  await _sheet.parse();
}

/** Get the current parsed Spritesheet (or null). */
export function getSheet() { return _sheet; }

/**
 * Show an animation unit's clip, starting on its first frame.
 * @param {{ animName: string, anchor: {x:number,y:number}, sourceSize?: {w:number,h:number} }} pb
 *   animName: key into the parsed Spritesheet's animations.
 * @param {{ onFrameChange?: (index: number, total: number) => void }} [opts]
 */
export function playUnit(pb, opts = {}) {
  if (!sprite || !app) return;
  const textures = _sheet?.animations[pb.animName];
  if (!textures) {
    console.warn('playUnit: no textures resolved for', pb.animName);
    return;
  }
  currentPb = pb;
  _paused = false;
  _onFrameChange = opts.onFrameChange || null;

  sprite.textures = textures;
  sprite.anchor.set(pb.anchor.x, pb.anchor.y);
  layoutSprite(); // centred, feet at 65% of the height, source frame fitted to ~55%
  sprite.onFrameChange = () => {
    _emitFrame();
    updateOnionSkin();
  };
  sprite.gotoAndStop(0);
  _emitFrame();
  updateOnionSkin();
  positionCrosshair(pb.anchor);
}

// --- Playback clock + frame-by-frame inspection ---

let _paused = false;
let _onFrameChange = null;
let _clock = null;

/**
 * Set the playback clock: called every ticker frame with the elapsed ms while
 * playback runs, it returns the frame index to show (or null for no change).
 * @param {((deltaMs: number) => number|null|undefined) | null} clock
 */
export function setClock(clock) { _clock = clock; }

function advanceClock(ticker) {
  if (_paused || !_clock || !sprite) return;
  let index;
  try {
    index = _clock(ticker.deltaMS);
  } catch (error) {
    // A throw would escape the ticker's requestAnimationFrame callback and stop rendering for good.
    console.error('Preview clock failed:', error);
    return;
  }
  if (Number.isInteger(index) && index >= 0 && index < sprite.totalFrames && index !== sprite.currentFrame) {
    sprite.gotoAndStop(index);
  }
}

function _emitFrame() {
  if (!sprite || !_onFrameChange) return;
  _onFrameChange(sprite.currentFrame, sprite.totalFrames);
}

/** Pause playback on the current frame. */
export function pauseAnimation() {
  if (!sprite) return;
  _paused = true;
  _emitFrame();
}

/** Resume playback; the clock continues from where it was paused. */
export function resumeAnimation() {
  if (!sprite) return;
  _paused = false;
}

/** Step to the next frame (wraps). */
export function nextFrame() {
  if (!sprite) return;
  pauseAnimation();
  sprite.gotoAndStop((sprite.currentFrame + 1) % sprite.totalFrames);
}

/** Step to the previous frame (wraps). */
export function prevFrame() {
  if (!sprite) return;
  pauseAnimation();
  sprite.gotoAndStop((sprite.currentFrame - 1 + sprite.totalFrames) % sprite.totalFrames);
}

/** Jump to a specific frame directly. */
export function gotoFrame(idx) {
  if (!sprite) return;
  pauseAnimation();
  if (idx >= 0 && idx < sprite.totalFrames) sprite.gotoAndStop(idx);
}

/** Toggle play/pause. Returns true if now playing. */
export function togglePlayPause() {
  if (_paused) { resumeAnimation(); return true; }
  else { pauseAnimation(); return false; }
}

/** Query state. */
export function isPaused() { return _paused; }
export function getFrameInfo() {
  if (!sprite) return { current: 0, total: 1 };
  return { current: sprite.currentFrame, total: sprite.totalFrames };
}

export function setAnchor(x, y) {
  if (!sprite) return;
  sprite.anchor.set(x, y);
  positionCrosshair({ x, y });
  updateOnionSkin();
}

export function positionCrosshair(anchor, visible) {
  if (!pivotGraphics) return;
  const show = visible ?? pivotGraphics.visible;
  pivotGraphics.visible = show;
  if (show && sprite) {
    if (!draggingPivot) {
      pivotGraphics.x = sprite.x;
      pivotGraphics.y = sprite.y;
    }
  }
}

export function setOnionSkin(enabled) {
  _onionEnabled = enabled;
  updateOnionSkin();
}

function updateOnionSkin() {
  if (!sprite || !prevSprite || !nextSprite) return;
  if (!_onionEnabled || sprite.totalFrames <= 1) {
    prevSprite.visible = false;
    nextSprite.visible = false;
    return;
  }

  const cur = sprite.currentFrame;
  const tot = sprite.totalFrames;
  const prevIdx = (cur - 1 + tot) % tot;
  const nextIdx = (cur + 1) % tot;

  if (sprite.textures && sprite.textures[prevIdx] && sprite.textures[nextIdx]) {
    const getTex = (t) => t && (t.texture ? t.texture : t);
    prevSprite.texture = getTex(sprite.textures[prevIdx]);
    nextSprite.texture = getTex(sprite.textures[nextIdx]);

    const sync = (s) => {
      s.anchor.set(sprite.anchor.x, sprite.anchor.y);
      s.scale.set(sprite.scale.x, sprite.scale.y);
      s.x = sprite.x;
      s.y = sprite.y;
      s.visible = true;
    };
    sync(prevSprite);
    sync(nextSprite);
  } else {
    prevSprite.visible = false;
    nextSprite.visible = false;
  }
}

// --- Viewport Zoom & Pan ---
function setupViewportInteraction(canvas) {
  let panning = false;
  let panStart = { x: 0, y: 0 };
  let viewportStart = { x: 0, y: 0 };

  // 1. Mouse wheel Zoom (centered on cursor)
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!viewport) return;

    const zoomFactor = 1.15;
    const oldScale = viewport.scale.x;
    let newScale = oldScale;

    if (e.deltaY < 0) {
      newScale = Math.min(25, oldScale * zoomFactor);
    } else {
      newScale = Math.max(0.4, oldScale / zoomFactor);
    }

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Keep the world point under the cursor fixed while the scale changes.
    const worldX = (mouseX - viewport.x) / oldScale;
    const worldY = (mouseY - viewport.y) / oldScale;
    viewport.scale.set(newScale);
    viewport.x = mouseX - worldX * newScale;
    viewport.y = mouseY - worldY * newScale;
  }, { passive: false });

  // 2. Mouse Drag Pan (Middle, Right click or Alt + Left click)
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2 || e.button === 1 || e.altKey) {
      panning = true;
      panStart.x = e.clientX;
      panStart.y = e.clientY;
      viewportStart.x = viewport.x;
      viewportStart.y = viewport.y;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
      e.stopPropagation();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (panning && viewport) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      viewport.x = viewportStart.x + dx;
      viewport.y = viewportStart.y + dy;
      e.preventDefault();
    }
  });

  window.addEventListener('mouseup', () => {
    if (panning) {
      panning = false;
      canvas.style.cursor = 'default';
    }
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });
}

// --- PixiJS Pivot Dragging ---
function setupPivotDrag() {
  if (!pivotGraphics) return;

  pivotGraphics.on('pointerdown', (e) => {
    if (e.button === 0) { // Left click only for dragging anchor
      draggingPivot = true;
      dragAnchor = null;
      pivotGraphics.cursor = 'grabbing';
      e.stopPropagation(); // prevent panning the viewport
    }
  });

  pivotGraphics.on('globalpointermove', (e) => {
    if (!draggingPivot || !sprite || !currentPb) return;

    const localPos = viewport.toLocal(e.global, undefined, dragPoint);

    const sourceW = currentPb.sourceSize?.w || canvasSize;
    const sourceH = currentPb.sourceSize?.h || canvasSize;
    const fitScale = sprite.scale.x;

    // Formulas:
    // ax = (localPos.x - sprite.x) / (sourceW * fitScale) + sprite.anchor.x
    // ay = (localPos.y - sprite.y) / (sourceH * fitScale) + sprite.anchor.y
    const ax = (localPos.x - sprite.x) / (sourceW * fitScale) + sprite.anchor.x;
    const ay = (localPos.y - sprite.y) / (sourceH * fitScale) + sprite.anchor.y;

    const clampedX = parseFloat(Math.max(0, Math.min(1, ax)).toFixed(4));
    const clampedY = parseFloat(Math.max(0, Math.min(1, ay)).toFixed(4));

    // Live update crosshair position during dragging for a responsive feel
    pivotGraphics.x = localPos.x;
    pivotGraphics.y = localPos.y;

    dragAnchor = { x: clampedX, y: clampedY };
    bus.emit(EV.ANCHOR_DRAG, dragAnchor);
  });

  window.addEventListener('pointerup', () => {
    if (!draggingPivot) return;
    draggingPivot = false;
    if (pivotGraphics) pivotGraphics.cursor = 'pointer';
    if (dragAnchor) bus.emit(EV.ANCHOR_DROP, dragAnchor);
    dragAnchor = null;
  });
}
