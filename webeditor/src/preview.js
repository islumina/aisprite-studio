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
import { CHROMA_DEFAULTS, detectKeyColor, readBorderPixels } from './chroma.js';
import { createChromaFilter, setChromaUniforms } from './chroma-filter.js';
import { DEFAULT_SOURCE_SIZE } from './constants.js';
import { setupViewportInteraction } from './viewport.js';

let app = null;
let sprite = null;
let crosshairEl = null;
let currentPb = null;
let _sheet = null; // current parsed Spritesheet instance
let _sheetTexture = null; // the whole sheet image, for export
let _sheetBitmap = null; // ImageBitmap behind _sheetTexture; closed when the sheet is replaced
// Chroma key: the colour comes from the sheet's border (chroma.js) and is keyed on the GPU.
let _chroma = { enabled: true, similarity: CHROMA_DEFAULTS.similarity };
let _sheetKey = { key: null, reason: 'empty' }; // detectKeyColor() result for the loaded sheet
let keyFilter = null; // main sprite; attached only while a key applies
let prevFilter = null; // onion skins: always attached, they also carry the onion tint
let nextFilter = null;
let prevSprite = null;
let nextSprite = null;
let _onionEnabled = false;

// Viewport zoom & pan, and interactive pivot graphics
let viewport = null;
let pivotGraphics = null;
let draggingPivot = false;
let dragAnchor = null; // last anchor reported during the current pivot drag
let hostObserver = null; // keeps the renderer the size of its host element
let windowListeners = null; // AbortController for this app's window listeners
const dragPoint = new PIXI.Point(); // reused out-parameter for toLocal() on every pointermove

/** Update the chroma key settings ({ enabled, similarity }); only uniforms change, nothing reloads. */
export function setChroma(opts) {
  _chroma = { ..._chroma, ...opts };
  applyChroma();
}
export function getChroma() { return { ..._chroma }; }
/** The key detected for the loaded sheet: `{ key: [r, g, b] }`, or `{ key: null, reason }`. */
export function getSheetKey() { return _sheetKey; }

function activeKey(detection) {
  return _chroma.enabled ? detection?.key ?? null : null;
}

function applyChroma() {
  const settings = { key: activeKey(_sheetKey), similarity: _chroma.similarity };
  for (const filter of [keyFilter, prevFilter, nextFilter]) if (filter) setChromaUniforms(filter, settings);
  if (sprite) sprite.filters = settings.key ? [keyFilter] : null;
}

/** Fetch and decode an image. The caller owns the bitmap and must close() it. */
export async function loadBitmap(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return createImageBitmap(await response.blob());
}

/** Detect the key colour of a decoded image (see chroma.js). */
export function detectImageKey(bitmap) {
  try {
    return detectKeyColor(readBorderPixels(bitmap));
  } catch (error) {
    console.warn('Chroma key detection failed; not keying this image:', error);
    return { key: null, reason: 'empty' };
  }
}

/** Wrap a bitmap in a texture the way PixiJS's own loader does. */
function bitmapTexture(bitmap) {
  return new PIXI.Texture({
    source: new PIXI.ImageSource({ resource: bitmap, alphaMode: 'premultiply-alpha-on-upload' }),
  });
}

/**
 * Render an image through the chroma key at its own pixel size, for export.
 * @param {ImageBitmap | PIXI.Texture} source
 * @param {{ key: [number, number, number] | null }} detection  Usually detectImageKey(source).
 * @returns {HTMLCanvasElement | null} null when nothing would be keyed (key off, or the image has alpha).
 */
export function keyedCanvas(source, detection) {
  const key = activeKey(detection);
  if (!app || !key) return null;
  const texture = source instanceof PIXI.Texture ? source : bitmapTexture(source);
  const filter = createChromaFilter({ straightAlpha: true });
  setChromaUniforms(filter, { key, similarity: _chroma.similarity });
  const keyedSprite = new PIXI.Sprite(texture);
  keyedSprite.filters = [filter];
  const root = new PIXI.Container(); // the filter sits on a child, so it is part of what is rendered
  root.addChild(keyedSprite);
  try {
    return app.renderer.extract.canvas({ target: root, resolution: 1 });
  } finally {
    root.destroy({ children: true });
    filter.destroy();
    if (texture !== source) texture.destroy(true); // the caller still owns and closes the bitmap
  }
}

/** The loaded sheet keyed to transparency (for Export keyed PNG / Save), or null when nothing is keyed. */
export function getKeyedSheetCanvas() {
  return _sheetTexture ? keyedCanvas(_sheetTexture, _sheetKey) : null;
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
  windowListeners?.abort();
  windowListeners = new AbortController();
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
    await app.init({
      width: vw,
      height: vh,
      backgroundAlpha: 0,
      antialias: true,
      // Render at the device pixel ratio. autoDensity keeps the canvas CSS size at
      // width × height, so stage units, Pixi pointer events and the wheel/pan maths
      // (client coordinates) all stay in CSS pixels.
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preference: 'webgl', // the chroma filter is GLSL only
    });
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
  // Onion skins: 22% alpha, red-ish behind and blue-ish ahead, applied after keying.
  keyFilter = createChromaFilter();
  prevFilter = createChromaFilter({ tint: [1, 0.53, 0.53, 0.22] });
  nextFilter = createChromaFilter({ tint: [0.53, 0.53, 1, 0.22] });
  prevSprite.filters = [prevFilter];
  nextSprite.filters = [nextFilter];
  applyChroma();

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
  setupViewportInteraction(app.canvas, viewport, windowListeners.signal);
  setupPivotDrag(windowListeners.signal);
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
  const resolution = window.devicePixelRatio || 1; // browser zoom changes it along with the CSS size
  if (w === app.screen.width && h === app.screen.height && resolution === app.renderer.resolution) return;
  app.renderer.resize(w, h, resolution);
  layoutSprite();
  app.render(); // resizing clears the canvas; draw now rather than show a blank frame
}

/** Centre the sprite and fit its source frame to ~55% of the renderer. */
function layoutSprite() {
  if (!sprite || !app) return;
  const rw = app.screen.width; // CSS pixels, whatever the resolution
  const rh = app.screen.height;
  sprite.x = rw / 2;
  sprite.y = rh * 0.65;
  if (!currentPb) return;
  // sourceSize is the original untrimmed frame size (e.g. 512x512)
  const sourceH = currentPb.sourceSize?.h || DEFAULT_SOURCE_SIZE.h;
  const sourceW = currentPb.sourceSize?.w || DEFAULT_SOURCE_SIZE.w;
  const fitScale = Math.min((rh * 0.55) / sourceH, (rw * 0.55) / sourceW);
  sprite.scale.set(fitScale, fitScale);
  updateOnionSkin();
  positionCrosshair(currentPb.anchor);
}

/**
 * Load a spritesheet image and parse it with PixiJS Spritesheet (trim, sourceSize, anchor).
 * The image is fetched and decoded here rather than through PixiJS Assets, so no
 * cache-busted URL is left in the Assets cache, and its bitmap is closed on replace.
 * @param {string} imageUrl - path to the sheet image
 * @param {object} atlasData - parsed atlas.json object
 * @returns {Promise<{ key: [number, number, number] | null, reason?: string }>} the detected chroma key
 */
export async function loadSheet(imageUrl, atlasData) {
  // Query strings corrupt data URLs. Hosted/demo sheets are generated in-memory,
  // while file-backed sheets still need cache busting for regeneration previews.
  const bustUrl = /^(data:|blob:)/.test(imageUrl)
    ? imageUrl
    : imageUrl + (imageUrl.includes('?') ? '&' : '?') + `_t=${Date.now()}`;
  const bitmap = await loadBitmap(bustUrl); // before releasing anything, so a failed fetch keeps the old sheet
  const detection = detectImageKey(bitmap);

  // Detach the old textures before destroying them.
  if (sprite) sprite.textures = [PIXI.Texture.EMPTY];
  if (prevSprite) prevSprite.texture = PIXI.Texture.EMPTY;
  if (nextSprite) nextSprite.texture = PIXI.Texture.EMPTY;
  _sheet?.destroy(true); // also destroys the base texture and its source
  _sheet = null;
  _sheetTexture = null;
  _sheetBitmap?.close();
  _sheetBitmap = bitmap;

  _sheetTexture = bitmapTexture(bitmap);
  _sheet = new PIXI.Spritesheet({ texture: _sheetTexture, data: atlasData });
  await _sheet.parse();
  _sheetKey = detection;
  applyChroma();
  return detection;
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

// --- PixiJS Pivot Dragging ---
function setupPivotDrag(signal) {
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

    const sourceW = currentPb.sourceSize?.w || DEFAULT_SOURCE_SIZE.w;
    const sourceH = currentPb.sourceSize?.h || DEFAULT_SOURCE_SIZE.h;
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
  }, { signal });
}
