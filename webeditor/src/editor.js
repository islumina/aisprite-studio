// AI Sprite Studio — editor controller
//
// Wires the panels together. Responsibilities: load an atlas (served reimu, a
// dropped file, or the procedural mock), drive the PixiJS preview through the
// aispritejs runtime, expose loop/hold/return + duration tuning that reflects
// instantly, render the T-Pose panel, keep the JSON editor in sync both ways,
// and reload the spritesheet after an image agent regenerates it.
import { bus, EV } from './bus.js';
import { normaliseAtlas, getUnits, initialUnit, resolvePlayback, setOnEnd, setDuration, setAnchor, setAnchorAll, summariseFrameDurations } from './atlas-model.js';
import { createPreviewRuntime, validateAtlas } from './runtime.js';
import { generateMockSheet } from './mock.js';
import * as preview from './preview.js';
import { setupTimeline } from './timeline.js';
import { initKeyboard } from './keyboard.js';
import { createStudioHostBridge } from './host-bridge.js';
import { resolveStudioMode } from './mode.js';
import { configureAgentHandoff } from './agent-handoff.js';
import { createPosePanels } from './pose-panels.js';
import { createPromptSource, demoFramePrompt, frameName } from './prompts.js';
import { ANCHOR_DRAG_THROTTLE_MS, DEFAULT_ANCHOR, DEFAULT_SOURCE_SIZE, parseAnchorValue } from './constants.js';

// --- Utilities ---
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// --- DOM ---
const $ = (id) => document.getElementById(id);
const els = {
  canvas: $('canvas-container'), crosshair: $('crosshair'), json: $('json-editor'),
  unitSelect: $('unit-select'), viewerUnitSelect: $('viewer-unit-select'), srStatus: $('sr-status'),
  bootError: $('boot-error'), jsonHint: $('json-hint'),
  sourceBadge: $('source-badge'), typeBadge: $('assettype-badge'), stateBadge: $('current-state-badge'),
  speed: $('speed-slider'), durationVal: $('duration-val'),
  endLoop: $('end-loop'), endHold: $('end-hold'), endReturn: $('end-return'), endTarget: $('end-return-target'),
  pivot: $('show-pivot'), apply: $('btn-apply'), exportBtn: $('btn-export'), reload: $('btn-reload'),
  characterSelect: $('character-select'),
  refPoseImg: $('reference-pose-img'),
  refPoseInfo: $('reference-pose-info'),
  refPoseFilename: $('ref-pose-filename'),
  refPosePlaceholder: $('reference-pose-placeholder'),
  tposeGenerated: $('tpose-generated'),
  tposeImg: $('tpose-img'),
  btnCopyTposeUrl: $('btn-copy-tpose-url'),
  tposePromptText: $('tpose-prompt-text'),
  btnCopyTposePrompt: $('btn-copy-tpose-prompt'),
  tposePlaceholder: $('tpose-placeholder'),
  // Animation prompt
  animPromptText: $('anim-prompt-text'),
  btnCopyAnimPrompt: $('btn-copy-anim-prompt'),
  // Frame prompt
  framePromptDetails: $('frame-prompt-details'),
  framePromptIdx: $('frame-prompt-idx'),
  framePromptText: $('frame-prompt-text'),
  btnCopyFramePrompt: $('btn-copy-frame-prompt'),
  wasdCard: $('wasd-card'),
  wasdKeys: $('wasd-keys'),
  spaceKeyRow: $('space-key-row'),
  wasdHint: $('wasd-hint'),
  anchorX: $('anchor-x'),
  anchorY: $('anchor-y'),
  // Frame inspector
  frameBar: $('frame-bar'),
  framePrev: $('frame-prev'),
  framePlayPause: $('frame-playpause'),
  frameNext: $('frame-next'),
  frameLabel: $('frame-label'),
  frameRegen: $('frame-regen'),
  frameCopyPath: $('frame-copy-path'),
  btnSaveFramePrompt: $('btn-save-frame-prompt'),
  btnSaveAnimPrompt: $('btn-save-anim-prompt'),
  autoReload: $('auto-reload'),
  chromaToggle: $('chroma-toggle'),
  chromaSim: $('chroma-sim'),
  chromaSimVal: $('chroma-sim-val'),
  chromaKeyInfo: $('chroma-key-info'),
  btnExportSheet: $('btn-export-sheet'),
  previewLock: $('preview-lock'),
  btnSaveDisk: $('btn-save-disk'),
  onionSkin: $('onion-skin'),
  applyAllAnchors: $('btn-apply-all-anchors'),
  timelineList: $('timeline-list'),
};

/** Tell screen readers about a change they would otherwise miss (polite live region). */
function announce(message) {
  if (els.srStatus && els.srStatus.textContent !== message) els.srStatus.textContent = message;
}

// --- State ---
let atlas = null;
let baseImageUrl = null; // sheet url without cache-bust, for reload
let runtime = null; // runtime.js preview runtime (the playback clock), or null when nothing plays
let pinnedUnit = null; // the state the preview lock keeps looping: the one picked, or the start state
let currentUnit = null;
let currentChar = null; // current character folder name
let currentPb = null; // current active playback config
let reloadCount = 0;
let jsonDirty = false; // in-memory atlas diverges from disk (tuning/edits) → auto-reload keeps it
let lastSheetMtime = 0; // for auto-reload polling
let hostBridge = null;

function studioContext() {
  return {
    mode: staticMode ? 'static' : 'local',
    asset: currentChar,
    unit: currentUnit,
    frameIndex: curFrameIdx,
    frameCount: curFrameTotal,
    readOnly: staticMode,
  };
}

function publishStudioContext() {
  hostBridge?.context(studioContext());
}

function configureHostBridge() {
  hostBridge = createStudioHostBridge({
    onCommand(command) {
      if (command.type === 'request-context') return publishStudioContext();
      if (staticMode) return; // read-only demo: no asset reloads or switches
      if (command.type === 'reload-assets') return els.reload?.click();
      const option = Array.from(els.characterSelect?.options ?? [])
        .find((candidate) => candidate.value === command.asset && !candidate.disabled);
      if (!option) return;
      els.characterSelect.value = command.asset;
      els.characterSelect.dispatchEvent(new Event('change'));
    },
  });
}
let pollTimer = null;
let curFrameIdx = 0;
let curFrameTotal = 1;
let previewLock = true; // loop the pinned state for inspection; a trigger still plays once and returns
const studioMode = resolveStudioMode(window.location);
const staticMode = studioMode === 'static';
// The pose panels are hidden on a static host, where assets/ does not exist.
const posePanels = staticMode ? null : createPosePanels(els);

function configureStaticUi() {
  // Controls that need server.mjs or assets/ on disk are marked in index.html.
  for (const element of document.querySelectorAll('[data-local-only]')) element.style.display = 'none';
  if (els.autoReload) {
    els.autoReload.checked = false;
    els.autoReload.closest('label')?.remove();
  }
  if (els.jsonHint) els.jsonHint.textContent = 'Edits reflect live in this read-only demo. Use Export JSON to keep them.';
}

// --- Prompt loading ---
const prompts = createPromptSource({ staticMode });

/** Untrimmed size of the playing frames, for demo prompts. */
const frameSize = () => resolvePlayback(atlas, currentUnit)?.sourceSize ?? DEFAULT_SOURCE_SIZE;

async function loadAnimPrompt(charName, animName) {
  if (!els.animPromptText) return;
  els.animPromptText.textContent = await prompts.animPrompt(charName, animName);
}

async function loadFramePrompt(charName, animName, frameIdx) {
  if (!els.framePromptDetails) return;
  els.framePromptIdx.textContent = frameIdx;
  els.framePromptText.textContent = await prompts.framePrompt(charName, animName, frameIdx, curFrameTotal, frameSize());
  els.framePromptDetails.style.display = '';
}

// --- Boot ---
async function start() {
  configureHostBridge();
  if (staticMode) configureStaticUi(); // before the renderer, so a boot failure still shows the right controls
  await preview.initPreview(els.canvas, els.crosshair);
  preview.setClock((deltaMs) => {
    if (!runtime) return null;
    runtime.tick(deltaMs);
    return runtime.frameIndex;
  });

  if (staticMode) {
    setupAgentHandoff();
    const m = generateMockSheet();
    els.characterSelect.innerHTML = '<option value="demo">Procedural demo</option>';
    els.characterSelect.disabled = true;
    await loadAtlas(m.atlas, m.imageUrl, 'Hosted read-only demo', 'demo');
    await hostBridge?.ready(studioContext());
    return;
  }

  // Populate character dropdown from /api/assets
  try {
    const assetsRes = await fetch('/api/assets');
    if (assetsRes.ok) {
      const assets = await assetsRes.json();
      els.characterSelect.innerHTML = '';
      for (const a of assets) {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = a.name + (a.hasAtlas ? '' : ' (no atlas)');
        opt.disabled = !a.hasAtlas;
        opt.dataset.prefix = a.atlasPrefix || '';
        opt.dataset.input = a.hasInput ? '1' : '';
        els.characterSelect.appendChild(opt);
      }
      // Select first available
      const first = assets.find(a => a.hasAtlas);
      if (first) els.characterSelect.value = first.name;
    }
  } catch (e) {
    console.warn('Could not load asset list:', e);
  }

  const urlParams = new URLSearchParams(window.location.search);
  const requestedChar = urlParams.get('char');
  // Compare option values directly: the query value never becomes part of a CSS selector.
  if (requestedChar && Array.from(els.characterSelect.options).some((option) => option.value === requestedChar && !option.disabled)) {
    els.characterSelect.value = requestedChar;
  }

  const charName = els.characterSelect?.value || 'reimu';
  try {
    await loadAsset(charName);
  } catch (e) {
    console.warn('Falling back to procedural mock:', e);
    const m = generateMockSheet();
    await loadAtlas(m.atlas, m.imageUrl, 'Mock Mode');
  }
  setupAgentHandoff();
  await hostBridge?.ready(studioContext());
}

// --- Asset loading (served assets/<name>) ---
/** Directory holding an asset's atlas.json: assets/<name>, or the prefix /api/assets reported (e.g. output). */
function assetBase(charName) {
  const option = Array.from(els.characterSelect?.options ?? []).find((candidate) => candidate.value === charName);
  const prefix = option?.dataset.prefix || '';
  return prefix ? `assets/${charName}/${prefix}` : `assets/${charName}`;
}

/** Fetch an asset's atlas.json and resolve the sheet image next to it. */
async function fetchAssetAtlas(charName) {
  const base = assetBase(charName);
  const response = await fetch(`${base}/atlas.json`);
  if (!response.ok) throw new Error(`${charName} atlas not reachable (HTTP ${response.status})`);
  const atlasData = await response.json();
  return { atlasData, imageUrl: `${base}/${atlasData.meta?.image || `${charName}.png`}` };
}

/** Load a served asset and refresh every panel that depends on it. */
async function loadAsset(charName) {
  const { atlasData, imageUrl } = await fetchAssetAtlas(charName);
  await loadAtlas(atlasData, imageUrl, `assets/${charName} Loaded`, charName);
  posePanels?.showReferencePose(charName, els.characterSelect.selectedOptions[0]?.dataset.input === '1');
  posePanels?.showTpose(charName);
  await afterCharLoaded(charName);
}

/** The active frame's generation task for the Agent Handoff card, or why there is none. */
async function activeFrameTask() {
  if (!atlas || !currentUnit) return 'no active frame';
  const pb = resolvePlayback(atlas, currentUnit);
  if (!pb) return 'invalid state';
  const frame = frameName(pb.animation, curFrameIdx);
  if (staticMode) {
    return {
      asset: currentChar,
      frame,
      prompt: demoFramePrompt(pb.animation, curFrameIdx, curFrameTotal, frameSize()),
      note: 'This hosted task is illustrative. Use the local MCP server for validated submission.',
    };
  }
  const task = await prompts.fetchTask('frame-task', { char: currentChar, frame });
  if (task.error) return task.error;
  return {
    schema: 'https://github.com/islumina/aisprite-studio/tree/main/mcp-server',
    ...task,
    note: 'Same task as aisprite_studio_get_generation_task, which also returns the PNG references.',
  };
}

function setupAgentHandoff() {
  configureAgentHandoff({ staticMode, flashLabel, activeFrameTask });
}

/** Load a sheet image into the preview and show which chroma key it got. */
async function loadSheetImage(imageUrl, atlasData) {
  reflectChromaKey(await preview.loadSheet(imageUrl, atlasData));
}

function reflectChromaKey(detection) {
  if (!els.chromaKeyInfo) return;
  els.chromaKeyInfo.textContent = detection?.key
    ? `Sheet key: rgb(${detection.key.join(', ')}), from its border`
    : detection?.reason === 'alpha'
      ? 'Sheet already has transparency, so it is not keyed.'
      : 'No flat background colour found, so the sheet is not keyed.';
}

/** Load an atlas object + its sheet image, then render every panel. */
async function loadAtlas(atlasObj, imageUrl, badge, charName = currentChar) {
  const next = normaliseAtlas(atlasObj);
  validateAtlas(next); // before touching the preview, so a bad atlas leaves the current one playing
  atlas = next;
  currentChar = charName; // before the first playState, which loads this asset's prompts
  baseImageUrl = imageUrl;
  // Use PixiJS Spritesheet for correct trim/anchor handling
  await loadSheetImage(imageUrl, atlasObj);

  els.sourceBadge.textContent = badge;
  els.sourceBadge.classList.add('active');
  els.typeBadge.textContent = atlas.assetType === 'object' ? 'Object / Icon' : 'Character';

  jsonDirty = false; // fresh load — in sync with disk
  writeJson();
  renderUnitSelect();

  pinnedUnit = initialUnit(atlas);
  restartRuntime(pinnedUnit);
}

/** (Re)start the preview runtime in `startState`; the pinned unit loops while the lock is on. */
function restartRuntime(startState) {
  runtime?.dispose();
  runtime = null;
  runtime = createPreviewRuntime(atlas, {
    onState: playState,
    initialState: startState ?? undefined,
    loopState: previewLock ? pinnedUnit : null,
  });
  kbHandler?.updateFsm(runtime);
  reflectControls(runtime?.controls);
}

/** Show the keyboard card only for the inputs this graph declares. */
function reflectControls({ move = null, trigger = null } = {}) {
  if (!els.wasdCard) return;
  els.wasdCard.style.display = move || trigger ? '' : 'none';
  if (els.wasdKeys) els.wasdKeys.style.display = move ? 'grid' : 'none'; // inline display:grid beats [hidden]
  if (els.spaceKeyRow) els.spaceKeyRow.style.display = trigger ? '' : 'none';
  if (els.wasdHint) {
    els.wasdHint.textContent = [move && `WASD = ${move}`, trigger && `Space = ${trigger}`].filter(Boolean).join(' · ');
  }
}

// --- Playback ---
/** Play one unit's animation and reflect it in the controls. Single render path. */
function playState(name) {
  const pb = resolvePlayback(atlas, name);
  if (!pb) return;
  currentUnit = name;
  currentPb = pb;

  // Render timeline scrubber
  renderTimeline(pb);

  // Pass animation name — preview.js resolves textures from the parsed Spritesheet;
  // the runtime decides which frame shows and when the clip ends.
  preview.playUnit(
    { animName: pb.animation, anchor: pb.anchor, sourceSize: pb.sourceSize },
    { onFrameChange: (idx, total) => {
      curFrameIdx = idx; curFrameTotal = total;
      updateFrameLabel(idx, total);
      if (preview.isPaused()) announce(`Frame ${idx + 1} of ${total}`);
      highlightTimelineFrame(idx);
      // Only refresh the per-frame prompt when its panel is open (avoid per-frame spam during playback).
      if (currentChar && els.framePromptDetails?.open) loadFramePrompt(currentChar, pb.animation, idx);
    }},
  );
  updatePlayPauseBtn(true);
  reflectUnitUI(name, pb);
  // Load animation-level prompt
  if (currentChar) loadAnimPrompt(currentChar, pb.animation);
}

// --- Frame inspector helpers ---

const timeline = setupTimeline(
  els,
  () => atlas,
  () => curFrameIdx,
  () => updatePlayPauseBtn(false)
);

function renderTimeline(pb) {
  timeline.render(pb);
}

function highlightTimelineFrame(idx) {
  timeline.highlight(idx);
}

function updateFrameLabel(current, total) {
  if (els.frameLabel) {
    els.frameLabel.innerHTML = `<strong>${current + 1}</strong> / ${total}`;
  }
}

function updatePlayPauseBtn(playing) {
  if (!els.framePlayPause) return;
  // The icon shows the action (pause while playing); aria-pressed carries the state.
  els.framePlayPause.querySelector('use')?.setAttribute('href', playing ? '#icon-pause' : '#icon-play');
  els.framePlayPause.setAttribute('aria-pressed', String(playing));
  els.framePlayPause.classList.toggle('active', playing);
}

/** Jump straight to a unit for inspection: it becomes the pinned state and the runtime restarts there. */
function seekUnit(name) {
  pinnedUnit = name;
  restartRuntime(name);
}

// --- UI rendering ---
// The sidebar picker and the viewer-mode picker (narrow screens) show the same list.
const unitSelects = [els.unitSelect, els.viewerUnitSelect].filter(Boolean);

function renderUnitSelect() {
  for (const select of unitSelects) {
    select.innerHTML = '';
    for (const u of getUnits(atlas)) {
      const opt = document.createElement('option');
      opt.value = u.name;
      opt.textContent = u.name;
      if (u.name === currentUnit) opt.selected = true;
      select.appendChild(opt);
    }
  }
}

for (const select of unitSelects) {
  select.addEventListener('change', () => {
    const name = select.value;
    if (!name) return;
    seekUnit(name);
  });
}

function reflectUnitUI(name, pb) {
  if (els.stateBadge.textContent !== name) announce(`State: ${name}`);
  els.stateBadge.textContent = name;
  for (const select of unitSelects) select.value = name;
  // End-behaviour segmented control
  const isLoop = pb.onEnd === 'loop';
  const isHold = pb.onEnd === 'hold';
  const segments = [[els.endLoop, isLoop], [els.endHold, isHold], [els.endReturn, !isLoop && !isHold]];
  for (const [button, on] of segments) {
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
  }
  populateReturnTargets(name, !isLoop && !isHold ? pb.onEnd : null);
  els.endTarget.style.display = !isLoop && !isHold ? '' : 'none';
  reflectDuration(pb);
  // Anchor
  if (els.anchorX) els.anchorX.value = (pb.anchor?.x ?? DEFAULT_ANCHOR.x).toFixed(2);
  if (els.anchorY) els.anchorY.value = (pb.anchor?.y ?? DEFAULT_ANCHOR.y).toFixed(2);
}

/** Show the per-frame duration that actually plays (the mean when frames differ). */
function reflectDuration(pb) {
  const { ms, uniform } = summariseFrameDurations(pb.frameDurations);
  els.speed.value = ms;
  els.durationVal.textContent = uniform ? `${ms}ms` : `avg ${ms}ms`;
}

/** Fill the "Return to…" dropdown with the other states (character mode). */
function populateReturnTargets(current, selected) {
  els.endTarget.innerHTML = '';
  const others = getUnits(atlas).map((u) => u.name).filter((n) => n !== current);
  for (const n of others) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = `→ ${n}`;
    if (n === selected) opt.selected = true;
    els.endTarget.appendChild(opt);
  }
  if (!others.length) {
    const opt = document.createElement('option');
    opt.textContent = '(no other state)';
    els.endTarget.appendChild(opt);
  }
}

// Write in-memory state back to JSON editor
function writeJson() {
  if (document.activeElement === els.json) return; // don't fight the user's cursor
  els.json.value = JSON.stringify(atlas, null, 2);
}
const debouncedWriteJson = debounce(writeJson, 250);

// --- Controls ---
els.endLoop.onclick = () => currentUnit && setOnEnd(atlas, currentUnit, 'loop');
els.endHold.onclick = () => currentUnit && setOnEnd(atlas, currentUnit, 'hold');
els.endReturn.onclick = () => {
  if (!currentUnit) return;
  const target = els.endTarget.value || getUnits(atlas).map((u) => u.name).find((n) => n !== currentUnit);
  if (target) setOnEnd(atlas, currentUnit, target);
};
els.endTarget.onchange = () => currentUnit && setOnEnd(atlas, currentUnit, els.endTarget.value);

// Preview lock: when checked, the pinned state loops; when unchecked, its end behaviour applies.
els.previewLock?.addEventListener('change', () => {
  previewLock = els.previewLock.checked;
  if (!atlas) return;
  if (previewLock && currentUnit) pinnedUnit = currentUnit;
  restartRuntime(currentUnit);
});

// Writes every frame's duration through the model; the ATLAS_CHANGED handler
// restarts the runtime with the new per-frame times.
els.speed.oninput = (e) => {
  const ms = parseInt(e.target.value, 10);
  if (currentUnit && ms > 0) setDuration(atlas, currentUnit, ms);
};

els.pivot.onchange = () => {
  const pb = currentUnit && resolvePlayback(atlas, currentUnit);
  preview.positionCrosshair(pb ? pb.anchor : DEFAULT_ANCHOR, els.pivot.checked);
};

// Anchor inputs
function onAnchorInput() {
  const x = parseAnchorValue(els.anchorX.value, DEFAULT_ANCHOR.x);
  const y = parseAnchorValue(els.anchorY.value, DEFAULT_ANCHOR.y);
  preview.setAnchor(x, y);
  if (currentUnit) setAnchor(atlas, currentUnit, { x, y });
}
els.anchorX?.addEventListener('change', onAnchorInput);
els.anchorY?.addEventListener('change', onAnchorInput);

els.apply.onclick = () => applyJsonText(true);
els.json.addEventListener('input', debounce(() => applyJsonText(false), 400));

/** Parse the JSON textarea and rebuild. `rewrite`=true echoes formatted JSON back. */
async function applyJsonText(rewrite) {
  let parsed;
  const errEl = $('json-error-msg');
  try {
    parsed = JSON.parse(els.json.value);
    parsed = normaliseAtlas(parsed);
    validateAtlas(parsed);
    if (errEl) {
      errEl.style.display = 'none';
      errEl.textContent = '';
    }
  } catch (err) {
    els.json.classList.add('json-invalid');
    els.json.setAttribute('aria-invalid', 'true');
    if (errEl) {
      errEl.style.display = 'block';
      // role="alert" re-announces on every write; only write when the message changes.
      if (errEl.textContent !== err.message) errEl.textContent = err.message;
    }
    return;
  }
  els.json.classList.remove('json-invalid');
  els.json.removeAttribute('aria-invalid');
  jsonDirty = true; // user-edited atlas; auto-reload must not clobber it
  atlas = parsed;
  renderUnitSelect();
  els.typeBadge.textContent = atlas.assetType === 'object' ? 'Object / Icon' : 'Character';
  restartRuntime(currentUnit);
  if (rewrite) {
    writeJson();
    if (errEl) {
      errEl.style.display = 'none';
      errEl.textContent = '';
    }
  }
}

els.exportBtn.onclick = () => {
  const blob = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(atlas, null, 2));
  const a = document.createElement('a');
  a.href = blob;
  a.download = 'atlas.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// --- Chroma key (GPU filter: settings only update uniforms, nothing reloads) ---
els.chromaToggle?.addEventListener('change', () => {
  preview.setChroma({ enabled: els.chromaToggle.checked });
  if (currentChar) posePanels?.showTpose(currentChar);
});
els.chromaSim?.addEventListener('input', () => {
  const similarity = parseFloat(els.chromaSim.value);
  els.chromaSimVal.textContent = similarity.toFixed(2);
  preview.setChroma({ similarity });
});
els.chromaSim?.addEventListener('change', () => { if (currentChar) posePanels?.showTpose(currentChar); });

els.btnExportSheet?.addEventListener('click', () => {
  const cv = preview.getKeyedSheetCanvas();
  if (!cv) {
    flashLabel(els.btnExportSheet, '✗ nothing to key', false);
    return;
  }
  cv.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sheet.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
});

// Reload the sheet image from disk after regeneration while keeping JSON edits.
els.reload.onclick = async () => {
  if (!baseImageUrl) return;
  els.reload.classList.add('busy');
  await loadSheetImage(baseImageUrl, atlas);
  if (currentUnit) playState(currentUnit);
  els.reload.classList.remove('busy');
  els.sourceBadge.textContent = `Reloaded ×${++reloadCount}`;
};

// --- Bus: model changes reflect everywhere ---
// The animator compiles frame times when it is built, so timing edits restart it.
// Debounced: a slider drag would otherwise restart the clip on every input event.
const restartAfterTimingEdit = debounce(() => {
  if (!currentUnit) return;
  const pausedAt = preview.isPaused() ? curFrameIdx : null;
  restartRuntime(currentUnit);
  if (pausedAt !== null) { // stay paused on the frame being inspected
    preview.gotoFrame(pausedAt);
    updatePlayPauseBtn(false);
  }
}, 150);

bus.on(EV.ATLAS_CHANGED, ({ reason }) => {
  jsonDirty = true; // tuning diverges from disk; auto-reload keeps it

  const timing = reason.startsWith('duration:') || reason.startsWith('frame-duration:');
  // Debounce writing back to textarea for high-frequency events to maintain 60 FPS performance
  if (reason.startsWith('anchor:') || timing) {
    debouncedWriteJson();
  } else {
    writeJson();
  }

  if (timing) {
    const pb = currentUnit && resolvePlayback(atlas, currentUnit);
    if (pb) {
      reflectDuration(pb);
      if (reason.startsWith('duration:')) renderTimeline(pb); // slider rewrote every frame
      restartAfterTimingEdit();
    }
  } else if (reason.startsWith('onEnd') && currentUnit) {
    restartRuntime(currentUnit);
  } else if (reason === 'anchor:all' && currentUnit) {
    playState(currentUnit); // apply loop/hold live
  }
});
// Pivot drag: mirror the crosshair into the inputs on every move (cheap). Writing
// the anchor rewrites every frame of the clip, so live writes are throttled, and
// the drop commits the final position, which the throttle may have skipped.
function commitAnchor({ x, y }) {
  if (currentUnit) setAnchor(atlas, currentUnit, { x, y });
}
bus.on(EV.ANCHOR_DRAG, ({ x, y }) => {
  if (els.anchorX) els.anchorX.value = x.toFixed(2);
  if (els.anchorY) els.anchorY.value = y.toFixed(2);
});
bus.on(EV.ANCHOR_DRAG, commitAnchor, { throttleMs: ANCHOR_DRAG_THROTTLE_MS });
bus.on(EV.ANCHOR_DROP, (anchor) => {
  commitAnchor(anchor);
  preview.setAnchor(anchor.x, anchor.y); // the chosen point becomes the pivot, like typing it
});

// --- Character switch ---
els.characterSelect?.addEventListener('change', async () => {
  const charName = els.characterSelect.value;
  if (!charName) return;
  try {
    await loadAsset(charName);
    publishStudioContext();
  } catch (e) {
    console.warn('Failed to load character:', charName, e);
  }
});

// --- Copy + interaction handlers ---
function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text)
    .then(() => flashLabel(btn, '✓ Copied'))
    .catch(() => flashLabel(btn, '✗ Copy failed', false));
}
els.btnCopyTposeUrl?.addEventListener('click', (e) => {
  copyToClipboard(e.currentTarget.dataset.url, e.currentTarget);
});
els.btnCopyTposePrompt?.addEventListener('click', (e) => {
  copyToClipboard(els.tposePromptText?.textContent || '', e.currentTarget);
});
els.btnCopyAnimPrompt?.addEventListener('click', (e) => {
  copyToClipboard(els.animPromptText?.textContent || '', e.currentTarget);
});
els.btnCopyFramePrompt?.addEventListener('click', (e) => {
  copyToClipboard(els.framePromptText?.textContent || '', e.currentTarget);
});
els.refPoseImg?.addEventListener('click', () => {
  if (els.refPoseImg.src) window.open(els.refPoseImg.src, '_blank');
});
els.tposeImg?.addEventListener('click', () => {
  if (els.tposeImg.src) window.open(els.tposeImg.src, '_blank');
});

// --- Keyboard (graph inputs: WASD → movement number input, Space → trigger) ---
function highlightKey(k, on) {
  const map = { w: 'key-w', a: 'key-a', s: 'key-s', d: 'key-d', ' ': 'key-space' };
  const el = $(map[k]);
  if (el) el.classList.toggle('key-active', on);
}
const kbHandler = initKeyboard(null, highlightKey);


// --- Frame inspector bar ---
els.framePrev?.addEventListener('click', () => {
  preview.prevFrame();
  updatePlayPauseBtn(false);
});
els.frameNext?.addEventListener('click', () => {
  preview.nextFrame();
  updatePlayPauseBtn(false);
});
els.framePlayPause?.addEventListener('click', () => {
  const playing = preview.togglePlayPause();
  updatePlayPauseBtn(playing);
});

// Arrow keys for frame stepping (only when not in text input)
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); preview.prevFrame(); updatePlayPauseBtn(false); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); preview.nextFrame(); updatePlayPauseBtn(false); }
  else if (e.key === ',') { const p = preview.togglePlayPause(); updatePlayPauseBtn(p); }
});

// --- After a character loads: mtime seed, polling ---
async function afterCharLoaded(charName) {
  await seedMtime(charName);
  startPolling();
}

async function seedMtime(charName) {
  try { const r = await fetch(`/api/status?char=${encodeURIComponent(charName)}`); if (r.ok) lastSheetMtime = (await r.json()).sheetMtime || 0; }
  catch { lastSheetMtime = 0; }
}

function startPolling() {
  if (pollTimer || staticMode) return;
  pollTimer = setInterval(checkForUpdates, 2000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// Pause polling entirely when the tab is hidden to save CPU/network
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPolling();
  else if (currentChar) startPolling();
});

async function checkForUpdates() {
  if (!els.autoReload?.checked || !currentChar) return;
  try {
    const r = await fetch(`/api/status?char=${encodeURIComponent(currentChar)}`);
    if (!r.ok) return;
    const s = await r.json();
    if (s.sheetMtime && s.sheetMtime > lastSheetMtime) {
      lastSheetMtime = s.sheetMtime;
      await autoReloadAssets();
    }
  } catch { /* no API server (plain static host) */ }
}

async function autoReloadAssets() {
  try {
    if (jsonDirty) { // keep the edited atlas, swap only the sheet image
      await loadSheetImage(`${assetBase(currentChar)}/${atlas.meta?.image || `${currentChar}.png`}`, atlas);
      if (currentUnit) playState(currentUnit);
      els.sourceBadge.textContent = '↻ sheet updated (JSON kept)';
    } else {
      const { atlasData, imageUrl } = await fetchAssetAtlas(currentChar);
      await loadAtlas(atlasData, imageUrl, '↻ auto-reloaded');
    }
  } catch (error) {
    console.warn('Auto-reload failed:', error);
  }
}

// --- Regenerate + save prompt handlers ---
const flashes = new WeakMap(); // button → { original: Node[], timer }

/** Briefly swap a button's label, keeping its icon, then restore the original nodes. */
function flashLabel(btn, label, ok = true) {
  if (!btn) return;
  const pending = flashes.get(btn);
  if (pending) clearTimeout(pending.timer);
  const original = pending?.original ?? [...btn.childNodes];
  const icon = original.find((node) => node instanceof Element && node.matches('svg'));
  btn.replaceChildren(...(icon ? [icon, ` ${label}`] : [label]));
  btn.classList.toggle('copied', ok);
  announce(label.replace(/^[✓✗]\s*/, ''));
  const timer = setTimeout(() => {
    btn.replaceChildren(...original);
    btn.classList.remove('copied');
    flashes.delete(btn);
  }, 1600);
  flashes.set(btn, { original, timer });
}

els.frameRegen?.addEventListener('click', async () => {
  if (!currentUnit) return;
  const pb = resolvePlayback(atlas, currentUnit);
  if (!pb) return;
  preview.pauseAnimation?.();
  updatePlayPauseBtn(false);
  const prompt = await prompts.framePrompt(currentChar, pb.animation, curFrameIdx, curFrameTotal, frameSize());
  if (els.framePromptDetails) { els.framePromptDetails.style.display = ''; els.framePromptDetails.open = true; }
  if (els.framePromptText) els.framePromptText.textContent = prompt;
  if (els.framePromptIdx) els.framePromptIdx.textContent = curFrameIdx;
  navigator.clipboard?.writeText(prompt);
  flashLabel(els.frameRegen, '✓ Copied — send to image agent');
});

els.frameCopyPath?.addEventListener('click', () => {
  if (!currentUnit || !currentChar) return;
  const pb = resolvePlayback(atlas, currentUnit);
  if (!pb) return;
  const paddedIdx = String(curFrameIdx).padStart(2, '0');
  const file = `${pb.animation}_${paddedIdx}.png`;
  const filePath = `assets/${currentChar}/frames/${file}`;
  navigator.clipboard?.writeText(filePath);
  flashLabel(els.frameCopyPath, `✓ ${file}`);
});

async function savePrompt(name, text, btn) {
  if (!currentChar) { flashLabel(btn, '✗ no character', false); return; }
  try {
    const r = await fetch('/api/prompt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ char: currentChar, name, text }),
    });
    const j = await r.json();
    flashLabel(btn, j.ok ? '✓ Saved' : '✗ ' + (j.error || 'failed'), j.ok);
  } catch { flashLabel(btn, '✗ no dev server', false); }
}

els.btnSaveFramePrompt?.addEventListener('click', (e) => {
  const pb = currentUnit && resolvePlayback(atlas, currentUnit);
  if (!pb) return;
  savePrompt(`${pb.animation}_${String(curFrameIdx).padStart(2, '0')}`, els.framePromptText?.textContent || '', e.currentTarget);
});
els.btnSaveAnimPrompt?.addEventListener('click', (e) => {
  const pb = currentUnit && resolvePlayback(atlas, currentUnit);
  if (!pb) return;
  savePrompt(pb.animation, els.animPromptText?.textContent || '', e.currentTarget);
});

// Populate the frame prompt the moment its panel is opened.
els.framePromptDetails?.addEventListener('toggle', () => {
  if (els.framePromptDetails.open && currentChar && currentUnit) {
    const pb = resolvePlayback(atlas, currentUnit);
    if (pb) loadFramePrompt(currentChar, pb.animation, curFrameIdx);
  }
});

els.btnSaveDisk?.addEventListener('click', async () => {
  if (!currentChar) { flashLabel(els.btnSaveDisk, '✗ no character', false); return; }
  els.btnSaveDisk.classList.add('busy');

  const prefix = els.characterSelect?.selectedOptions[0]?.dataset.prefix || '';
  const payload = { char: currentChar, prefix, atlas };
  // Only when a key applies; server.mjs rejects a keyedImage that is not a PNG data URL (null included).
  const keyed = preview.getKeyedSheetCanvas();
  if (keyed) payload.keyedImage = keyed.toDataURL('image/png');

  try {
    const r = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    flashLabel(els.btnSaveDisk, j.ok ? '✓ Saved to disk' : '✗ ' + (j.error || 'failed'), j.ok);
    if (j.ok) {
      jsonDirty = false;
    }
  } catch (e) {
    flashLabel(els.btnSaveDisk, '✗ save failed', false);
  } finally {
    els.btnSaveDisk.classList.remove('busy');
  }
});

// Onion Skin toggle
els.onionSkin?.addEventListener('change', () => {
  preview.setOnionSkin(els.onionSkin.checked);
});

// Apply anchor to all animations
els.applyAllAnchors?.addEventListener('click', () => {
  const x = parseAnchorValue(els.anchorX.value, DEFAULT_ANCHOR.x);
  const y = parseAnchorValue(els.anchorY.value, DEFAULT_ANCHOR.y);
  setAnchorAll(atlas, { x, y });
  flashLabel(els.applyAllAnchors, '✓ Applied to all');
});

// Anchor inputs keyboard nudge
const nudge = (el, amount) => {
  let val = parseFloat(el.value) || 0;
  val = Math.max(0, Math.min(1, val + amount));
  el.value = val.toFixed(2);
  onAnchorInput();
};
els.anchorX?.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); nudge(els.anchorX, 0.01); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); nudge(els.anchorX, -0.01); }
});
els.anchorY?.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); nudge(els.anchorY, 0.01); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); nudge(els.anchorY, -0.01); }
});

/** Replace the "Loading…" state with a visible error and tell the host page. */
function reportBootError(error) {
  console.error('AI Sprite Studio failed to start:', error);
  const message = error instanceof Error ? error.message : String(error);
  if (els.bootError) {
    els.bootError.textContent = `Preview failed to start: ${message}`;
    els.bootError.hidden = false;
  }
  els.sourceBadge.textContent = 'Failed to load';
  hostBridge?.error({ mode: studioMode, message });
}

start().catch(reportBootError);
