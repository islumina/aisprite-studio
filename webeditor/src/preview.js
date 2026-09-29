// AI Sprite Studio — PixiJS preview surface
//
// Uses PixiJS Spritesheet class for correct trim/anchor handling.
// Sprites are rendered with proper sourceSize padding and spriteSourceSize offsets.
import * as PIXI from 'pixi.js';
import { bus, EV } from './bus.js';
import { keyGreen } from './chroma.js';
import { createPool } from 'aipooljs';

// Coordinate/Point object pool to recycle temporary objects in high-frequency events (wheel, drag)
const pointPool = createPool({
  size: 16,
  create: () => ({ x: 0, y: 0 }),
  reset: (pt) => { pt.x = 0; pt.y = 0; }
});

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
  if (app) {
    app.destroy(
      { removeView: true, releaseGlobalResources: true },
      { children: true, texture: true, textureSource: true }
    );
  }
  app = new PIXI.Application();

  const viewportEl = container.closest('.viewport-container');
  const vw = viewportEl?.clientWidth || 512;
  const vh = viewportEl?.clientHeight || 512;
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
 * Play an animation unit.
 * @param {object} pb - { animName, anchor, durationMs, onEnd, sourceSize }
 *   animName: key into sheet.animations
 *   OR textures: pre-resolved Texture[] (fallback for mock mode)
 * @param {object} opts - { onAnimEnd, onFrameChange }
 */
export function playUnit(pb, opts = {}) {
  if (!sprite || !app) return;
  currentPb = pb;
  _paused = false;
  _onFrameChange = opts.onFrameChange || null;

  // Resolve textures: prefer Spritesheet animations, fallback to passed textures
  let textures;
  let timed = false; // per-frame durations drive playback, so animationSpeed stays 1
  if (_sheet && pb.animName && _sheet.animations[pb.animName]) {
    const rawTextures = _sheet.animations[pb.animName];
    if (pb.frameDurations && pb.frameDurations.length === rawTextures.length) {
      textures = rawTextures.map((tex, idx) => ({
        texture: tex,
        time: pb.frameDurations[idx]
      }));
      timed = true;
    } else {
      textures = rawTextures;
    }
  } else if (pb.textures) {
    textures = pb.textures;
  } else {
    console.warn('playUnit: no textures resolved for', pb.animName);
    return;
  }

  sprite.textures = textures;
  sprite.anchor.set(pb.anchor.x, pb.anchor.y);

  // Position: centered horizontally, feet at 88% of viewport height
  const rw = app.renderer.width;
  const rh = app.renderer.height;
  sprite.x = rw / 2;
  sprite.y = rh * 0.65;

  // Scale: fit the authored sourceSize to ~55% of viewport
  // sourceSize is the original untrimmed frame size (e.g. 512x512)
  const sourceH = pb.sourceSize?.h || canvasSize;
  const sourceW = pb.sourceSize?.w || canvasSize;
  const fitScale = Math.min((rh * 0.55) / sourceH, (rw * 0.55) / sourceW);
  sprite.scale.set(fitScale, fitScale);

  sprite.animationSpeed = timed ? 1 : 1000 / pb.durationMs / 60;
  sprite.loop = pb.onEnd === 'loop';
  sprite.onComplete = () => {
    if (pb.onEnd !== 'loop' && pb.onEnd !== 'hold') opts.onAnimEnd?.();
  };
  sprite.onFrameChange = () => {
    _emitFrame();
    updateOnionSkin();
  };
  sprite.gotoAndPlay(0);
  _emitFrame();
  updateOnionSkin();
  positionCrosshair(pb.anchor);
}

// --- Frame-by-frame inspection API ---

let _paused = false;
let _onFrameChange = null;

function _emitFrame() {
  if (!sprite || !_onFrameChange) return;
  _onFrameChange(sprite.currentFrame, sprite.totalFrames);
}

/** Pause animation on current frame. */
export function pauseAnimation() {
  if (!sprite) return;
  _paused = true;
  sprite.stop();
  _emitFrame();
}

/** Resume animation playback. */
export function resumeAnimation() {
  if (!sprite) return;
  _paused = false;
  sprite.play();
}

/** Step to the next frame (wraps). */
export function nextFrame() {
  if (!sprite) return;
  pauseAnimation();
  const next = (sprite.currentFrame + 1) % sprite.totalFrames;
  sprite.gotoAndStop(next);
  _emitFrame();
}

/** Step to the previous frame (wraps). */
export function prevFrame() {
  if (!sprite) return;
  pauseAnimation();
  const prev = (sprite.currentFrame - 1 + sprite.totalFrames) % sprite.totalFrames;
  sprite.gotoAndStop(prev);
  _emitFrame();
}

/** Jump to a specific frame directly. */
export function gotoFrame(idx) {
  if (!sprite) return;
  pauseAnimation();
  if (idx >= 0 && idx < sprite.totalFrames) {
    sprite.gotoAndStop(idx);
    _emitFrame();
  }
}

/** Update the durations for all frames in the current active animation dynamicially. */
export function updateFrameDurations(frameDurations) {
  if (!sprite || !currentPb) return;
  currentPb.frameDurations = frameDurations;
  if (_sheet && currentPb.animName && _sheet.animations[currentPb.animName]) {
    const rawTextures = _sheet.animations[currentPb.animName];
    if (frameDurations.length === rawTextures.length) {
      const curFrame = sprite.currentFrame;
      const isPlaying = !sprite.paused && !_paused; // use sprite.playing or custom _paused

      sprite.textures = rawTextures.map((tex, idx) => ({
        texture: tex,
        time: frameDurations[idx]
      }));
      sprite.animationSpeed = 1;

      sprite.gotoAndStop(curFrame);
      if (isPlaying) {
        sprite.play();
      } else {
        _emitFrame();
      }
    }
  }
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

    // Use pointPool to borrow temporary point for world coordinate calculation to avoid GC allocations
    pointPool.borrow((worldPt) => {
      worldPt.x = (mouseX - viewport.x) / oldScale;
      worldPt.y = (mouseY - viewport.y) / oldScale;

      viewport.scale.set(newScale);
      viewport.x = mouseX - worldPt.x * newScale;
      viewport.y = mouseY - worldPt.y * newScale;
    });
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
      pivotGraphics.cursor = 'grabbing';
      e.stopPropagation(); // prevent panning the viewport
    }
  });

  pivotGraphics.on('globalpointermove', (e) => {
    if (!draggingPivot || !sprite || !currentPb) return;

    // Use pointPool to borrow temporary point.
    // Pass it as the third parameter (outPoint) to viewport.toLocal to prevent PixiJS from allocating a new Point instance under high frequency dragging
    pointPool.borrow((tempPt) => {
      const localPos = viewport.toLocal(e.global, undefined, tempPt);

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

      bus.emit(EV.ANCHOR_DRAGGED, { x: clampedX, y: clampedY });
    });
  });

  window.addEventListener('pointerup', () => {
    if (draggingPivot) {
      draggingPivot = false;
      if (pivotGraphics) pivotGraphics.cursor = 'pointer';
    }
  });
}
