import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

import {
  initialUnit,
  normaliseAtlas,
  resolvePlayback,
  setDuration,
  setFrameDuration,
  summariseFrameDurations,
} from "../webeditor/src/atlas-model.js";
import { bus, EV } from "../webeditor/src/bus.js";
import { detectKeyColor, spillMask } from "../webeditor/src/chroma.js";
import {
  DEFAULT_ANCHOR,
  DEFAULT_FRAME_DURATION_MS,
  DEFAULT_SOURCE_SIZE,
  parseAnchorValue,
} from "../webeditor/src/constants.js";
import { allowedParentOrigin } from "../webeditor/src/host-bridge.js";
import { mockAtlas } from "../webeditor/src/mock.js";
import { resolveStudioMode } from "../webeditor/src/mode.js";
import { createPreviewRuntime, previewControls, toSpriteGraph, validateAtlas } from "../webeditor/src/runtime.js";
import { nextZoomScale, zoomAround, ZOOM } from "../webeditor/src/viewport.js";

// An aispritejs graph whose animationConfig fps implies 167 ms while every frame stores 150 ms.
function demoAtlas() {
  const cell = () => ({ frame: { x: 0, y: 0, w: 128, h: 128 }, duration: 150 });
  return normaliseAtlas({
    assetType: "character",
    frames: { idle_00: cell(), idle_01: cell(), hit_00: cell() },
    animations: { idle: ["idle_00", "idle_01"], hit: ["hit_00"] },
    animationConfig: { idle: { onEnd: "loop", fps: 6 }, hit: { onEnd: "idle", fps: 8 } },
    inputs: { hit: { type: "trigger" } },
    initial: "idle",
    states: {
      idle: { animation: "idle", loop: true },
      hit: { animation: "hit", loop: false, onEnd: "idle" },
    },
    transitions: [{ from: "*", to: "hit", when: [{ input: "hit", op: "Trigger" }] }],
  });
}

/** Start a runtime and record every state it enters. */
function recordRuntime(atlas, options) {
  const states = [];
  const runtime = createPreviewRuntime(atlas, { ...options, onState: (state) => states.push(state) });
  return { runtime, states };
}

/** Advance a runtime in 16 ms steps, like the preview ticker. */
function play(runtime, ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += 16) runtime.tick(16);
}

function captureReasons(run) {
  const reasons = [];
  const off = bus.on(EV.ATLAS_CHANGED, ({ reason }) => reasons.push(reason));
  try {
    run();
  } finally {
    off();
  }
  return reasons;
}

const WEBEDITOR = new URL("../webeditor/", import.meta.url);
const readWebeditor = (file) => readFile(new URL(file, WEBEDITOR), "utf8");

test("defaults to local mode only on a loopback host", () => {
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(resolveStudioMode({ hostname, search: "" }), "local", hostname);
    assert.equal(resolveStudioMode({ hostname, search: "?char=reimu" }), "local", hostname);
    assert.equal(resolveStudioMode({ hostname, search: "?mode=static" }), "static", hostname);
  }
  for (const hostname of ["islumina.org", "www.islumina.org", "localhost.example.com", "192.168.1.20", "0.0.0.0", ""]) {
    assert.equal(resolveStudioMode({ hostname, search: "" }), "static", hostname);
    assert.equal(resolveStudioMode({ hostname, search: "?mode=static" }), "static", hostname);
  }
});

test("?mode=local opts into local mode on any host, e.g. a LAN address", () => {
  for (const hostname of ["192.168.1.20", "10.0.0.5", "studio.local", "0.0.0.0", "localhost", "[::1]"]) {
    assert.equal(resolveStudioMode({ hostname, search: "?mode=local" }), "local", hostname);
    assert.equal(resolveStudioMode({ hostname, search: "?char=reimu&mode=local" }), "local", hostname);
  }
  // Exact values only; anything else falls back to the host default.
  for (const search of ["?mode=LOCAL", "?mode=", "?mode=local1", "?modes=local"]) {
    assert.equal(resolveStudioMode({ hostname: "192.168.1.20", search }), "static", search);
  }
  // The first value wins (URLSearchParams.get), so an appended ?mode=local cannot flip the hosted iframe URL.
  assert.equal(resolveStudioMode({ hostname: "islumina.org", search: "?mode=static&mode=local" }), "static");
});

test("the editor page loads nothing from a third-party origin", async () => {
  const withoutComments = (await readWebeditor("index.html")).replace(/<!--[\s\S]*?-->/g, "")
    + (await readWebeditor("style.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  const refs = [...withoutComments.matchAll(/(?:\b(?:src|href)\s*=\s*["']|url\(\s*["']?|@import\s+["'])([^"')\s]+)/g)]
    .map((match) => match[1]);
  assert.ok(refs.some((ref) => ref.endsWith(".woff2")), "fonts are referenced");
  assert.deepEqual(refs.filter((ref) => /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(ref)), [], "absolute or protocol-relative URLs");
  for (const ref of refs.filter((candidate) => !candidate.startsWith("#") && !candidate.startsWith("data:"))) {
    await access(new URL(ref, WEBEDITOR)); // every local reference resolves to a vendored file
  }
});

test("every icon reference has an inline symbol", async () => {
  const html = (await readWebeditor("index.html")).replace(/<!--[\s\S]*?-->/g, "");
  const symbols = new Set([...html.matchAll(/<symbol id="(icon-[a-z-]+)"/g)].map((match) => match[1]));
  const sources = html + await readWebeditor("src/editor.js");
  const used = new Set([...sources.matchAll(/#(icon-[a-z-]+)/g)].map((match) => match[1]));
  assert.ok(used.size >= 9);
  assert.deepEqual([...used].filter((id) => !symbols.has(id)), []);
});

test("every form control in index.html has an accessible name", async () => {
  const html = await readWebeditor("index.html");
  const labelled = new Set([...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((match) => match[1]));
  const controls = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)].map((match) => match[0]);
  assert.ok(controls.length >= 15);
  for (const tag of controls) {
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    assert.ok(/\baria-label(?:ledby)?="[^"]+"/.test(tag) || (id !== undefined && labelled.has(id)), tag);
  }
});

test("reports the frame duration that actually plays", () => {
  const atlas = demoAtlas();
  const pb = resolvePlayback(atlas, "idle");
  assert.equal(pb.durationMs, 167); // fps-derived fallback, not what plays
  assert.deepEqual(pb.frameDurations, [150, 150]);
  assert.deepEqual(summariseFrameDurations(pb.frameDurations), { ms: 150, uniform: true });
  assert.deepEqual(summariseFrameDurations([100, 200, 301]), { ms: 200, uniform: false });
  assert.deepEqual(summariseFrameDurations([]), { ms: 0, uniform: true });
});

test("the Frame Duration value becomes every frame's playback time", () => {
  const atlas = demoAtlas();
  const reasons = captureReasons(() => setDuration(atlas, "idle", 300));
  assert.deepEqual(reasons, ["duration:idle"]);
  assert.deepEqual(resolvePlayback(atlas, "idle").frameDurations, [300, 300]);
  assert.deepEqual(resolvePlayback(atlas, "hit").frameDurations, [150], "other animations are untouched");

  // aispritejs graphs scale playback by state.speed: stored time is ms × speed, playback is ms.
  const graph = normaliseAtlas({
    assetType: "character",
    frames: { run_00: { duration: 100 }, run_01: { duration: 100 } },
    animations: { run: ["run_00", "run_01"] },
    states: { run: { animation: "run", loop: true, speed: 2 } },
  });
  assert.deepEqual(resolvePlayback(graph, "run").frameDurations, [50, 50]);
  setDuration(graph, "run", 120);
  assert.equal(graph.frames.run_00.duration, 240);
  assert.deepEqual(resolvePlayback(graph, "run").frameDurations, [120, 120]);
});

test("timeline edits go through the atlas model", () => {
  const atlas = demoAtlas();
  const reasons = captureReasons(() => setFrameDuration(atlas, "idle_01", 450.4));
  assert.deepEqual(reasons, ["frame-duration:idle_01"]);
  assert.deepEqual(resolvePlayback(atlas, "idle").frameDurations, [150, 450]);
  assert.deepEqual(summariseFrameDurations(resolvePlayback(atlas, "idle").frameDurations), { ms: 300, uniform: false });
  assert.deepEqual(captureReasons(() => setFrameDuration(atlas, "missing", 100)), []);
});

test("trusts only a same-origin parent as the bridge target", () => {
  assert.equal(allowedParentOrigin("https://islumina.org", () => "https://islumina.org"), "https://islumina.org");
  assert.equal(allowedParentOrigin("https://islumina.org", () => "https://evil.example"), null);
  assert.equal(allowedParentOrigin("https://islumina.org", () => {
    throw new DOMException("Blocked a frame with origin", "SecurityError");
  }), null);
  assert.equal(allowedParentOrigin("null", () => "null"), null);
  assert.equal(allowedParentOrigin("", () => ""), null);
});

test("Space fires the graph's declared trigger, whatever its name", async () => {
  assert.deepEqual(previewControls(toSpriteGraph(mockAtlas())), { move: "speed", trigger: "hit" });
  assert.deepEqual(previewControls({ inputs: { boom: { type: "trigger" }, health: { type: "number" } } }), { move: null, trigger: "boom" });
  // reimu declares only a speed input: WASD moves it, Space has nothing to fire (the card hides it).
  const reimu = JSON.parse(await readFile(new URL("../assets/reimu/output/atlas.json", import.meta.url), "utf8"));
  assert.deepEqual(previewControls(toSpriteGraph(normaliseAtlas(reimu))), { move: "speed", trigger: null });
  const { runtime } = recordRuntime(normaliseAtlas(reimu));
  assert.equal(runtime.can("ATTACK"), false);
  runtime.send("MOVE");
  assert.equal(runtime.state, "walk");
  runtime.send("STOP");
  assert.equal(runtime.state, "idle");
  runtime.dispose();
});

test("a trigger plays once and returns, even with the preview lock on", () => {
  const atlas = normaliseAtlas(mockAtlas());
  // Lock on, idle pinned: Space plays hit once, then idle stays.
  const locked = recordRuntime(atlas, { initialState: "idle", loopState: "idle" });
  locked.runtime.send("ATTACK");
  play(locked.runtime, 2000);
  assert.deepEqual(locked.states, ["idle", "hit", "idle"]);
  locked.runtime.dispose();

  // Lock on, hit picked: it loops for inspection until Space releases the pin.
  const pinned = recordRuntime(atlas, { initialState: "hit", loopState: "hit" });
  play(pinned.runtime, 2000);
  assert.deepEqual(pinned.states, ["hit"]);
  pinned.runtime.send("ATTACK");
  play(pinned.runtime, 2000);
  assert.deepEqual(pinned.states, ["hit", "idle"]);
  pinned.runtime.dispose();

  // Lock off: the picked one-shot follows its onEnd.
  const unlocked = recordRuntime(atlas, { initialState: "hit" });
  play(unlocked.runtime, 2000);
  assert.deepEqual(unlocked.states, ["hit", "idle"]);
  unlocked.runtime.dispose();
});

test("the animator's frame index drives playback, including state speed", () => {
  const atlas = normaliseAtlas({
    frames: { run_00: { duration: 100 }, run_01: { duration: 100 } },
    animations: { run: ["run_00", "run_01"] },
    inputs: {},
    states: { run: { animation: "run", loop: true, speed: 2 } },
    transitions: [],
  });
  const { runtime } = recordRuntime(atlas);
  assert.equal(runtime.frameIndex, 0);
  runtime.tick(49);
  assert.equal(runtime.frameIndex, 0);
  runtime.tick(2); // 51 ms × speed 2 = 102 ms into the clip
  assert.equal(runtime.frameIndex, 1);
  runtime.dispose();
});

test("an atlas without a graph plays its animations with loop / hold / return", () => {
  const atlas = normaliseAtlas({
    assetType: "object",
    frames: { open_00: { duration: 100 }, open_01: { duration: 100 }, shine_00: { duration: 100 } },
    animations: { open: ["open_00", "open_01"], shine: ["shine_00"] },
    animationConfig: { open: { onEnd: "shine" }, shine: { onEnd: "loop" } },
  });
  assert.equal(initialUnit(atlas), "open");
  const { runtime, states } = recordRuntime(atlas);
  assert.deepEqual(runtime.controls, { move: null, trigger: null });
  play(runtime, 1000);
  assert.deepEqual(states, ["open", "shine"]);
  runtime.dispose();
  assert.equal(createPreviewRuntime(normaliseAtlas({ frames: {}, animations: {} })), null, "nothing to play");
});

test("the demo atlas is a valid aispritejs graph that fits the atlas schema", async () => {
  const atlas = mockAtlas();
  validateAtlas(normaliseAtlas(mockAtlas()));
  const schema = JSON.parse(await readFile(new URL("../schemas/atlas.schema.json", import.meta.url), "utf8"));
  for (const key of schema.required) assert.ok(key in atlas, `required ${key}`);
  assert.deepEqual(Object.keys(atlas).filter((key) => !(key in schema.properties)), [], "top-level keys the schema rejects");
  for (const [name, frame] of Object.entries(atlas.frames)) {
    for (const key of schema.properties.frames.additionalProperties.required) assert.ok(key in frame, `${name}.${key}`);
  }
  assert.equal(initialUnit(normaliseAtlas(atlas)), "idle");
});

test("the removed states.definitions shape fails with aispritejs's message", () => {
  const legacy = normaliseAtlas({
    frames: { idle_00: { duration: 100 } },
    animations: { idle: ["idle_00"] },
    states: { initial: "idle", definitions: { idle: { animation: "idle" } } },
  });
  assert.throws(() => validateAtlas(legacy), /event-driven/);
});

test("a throwing bus handler is logged and does not stop the others", () => {
  const seen = [];
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  const offThrowing = bus.on(EV.ATLAS_CHANGED, () => { throw new Error("boom"); });
  const offRecording = bus.on(EV.ATLAS_CHANGED, ({ reason }) => seen.push(reason));
  try {
    bus.emit(EV.ATLAS_CHANGED, { reason: "test" });
  } finally {
    offThrowing();
    offRecording();
    console.error = original;
  }
  assert.deepEqual(seen, ["test"]);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /atlas:changed/);
});

test("every bus event is named ns:verb and is both emitted and handled", async () => {
  const files = (await readdir(new URL("src/", WEBEDITOR))).filter((file) => file.endsWith(".js"));
  const source = (await Promise.all(files.map((file) => readWebeditor(`src/${file}`)))).join("\n");
  for (const [key, name] of Object.entries(EV)) {
    assert.match(name, /^[a-z]+:[a-z]+$/, key);
    assert.match(source, new RegExp(`bus\\.emit\\(EV\\.${key}\\b`), `${key} is emitted`);
    assert.match(source, new RegExp(`bus\\.on\\(EV\\.${key}\\b`), `${key} is handled`);
  }
});

/** RGBA border bytes: `count` pixels per [r, g, b, a] entry. */
function border(...runs) {
  return Uint8ClampedArray.from(runs.flatMap(([count, rgba]) => Array.from({ length: count }, () => rgba).flat()));
}

test("the chroma key colour comes from the image border", () => {
  assert.deepEqual(detectKeyColor(border([400, [0, 255, 0, 255]], [40, [200, 30, 30, 255]])), { key: [0, 255, 0] });
  // reimu's tpose: a noisy blue that straddles histogram bins, around rgb(20, 62, 182).
  const blue = [];
  for (let i = 0; i < 300; i++) blue.push([1, [18 + (i % 5), 58 + (i % 9), 178 + (i % 8), 255]]);
  const { key } = detectKeyColor(border(...blue, [60, [240, 240, 240, 255]]));
  assert.ok(key.every((channel, i) => Math.abs(channel - [20, 62, 182][i]) <= 4), String(key));
});

test("images that already have alpha, or no flat background, are not keyed", () => {
  // Packed sheets are pre-keyed: a transparent border.
  assert.deepEqual(detectKeyColor(border([300, [0, 0, 0, 0]], [100, [0, 255, 0, 255]])), { key: null, reason: "alpha" });
  assert.deepEqual(detectKeyColor(border([100, [0, 0, 0, 0]])), { key: null, reason: "alpha" });
  assert.deepEqual(
    detectKeyColor(border([100, [255, 0, 0, 255]], [100, [0, 255, 0, 255]], [100, [0, 0, 255, 255]])),
    { key: null, reason: "mixed" },
  );
  assert.deepEqual(detectKeyColor(new Uint8ClampedArray(0)), { key: null, reason: "empty" });
});

test("spill suppression targets the key's dominant channel only", () => {
  assert.deepEqual(spillMask([0, 255, 0]), [0, 1, 0]);
  assert.deepEqual(spillMask([20, 62, 182]), [0, 0, 1]);
  assert.deepEqual(spillMask([128, 128, 128]), [0, 0, 0]);
  assert.deepEqual(spillMask([200, 180, 60]), [0, 0, 0]);
});

test("anchor, size and frame-duration fallbacks come from constants.js", () => {
  const atlas = normaliseAtlas({ frames: { blink_00: {}, blink_01: {} }, animations: { blink: ["blink_00", "blink_01"] } });
  const pb = resolvePlayback(atlas, "blink");
  assert.deepEqual(pb.anchor, DEFAULT_ANCHOR);
  assert.deepEqual(pb.sourceSize, DEFAULT_SOURCE_SIZE);
  assert.deepEqual(pb.frameDurations, [DEFAULT_FRAME_DURATION_MS, DEFAULT_FRAME_DURATION_MS]);
  // The animator falls back to the same duration, so what plays matches what the UI shows.
  assert.equal(toSpriteGraph(atlas).defaultFrameDuration, DEFAULT_FRAME_DURATION_MS);
  const { runtime } = recordRuntime(atlas);
  runtime.tick(DEFAULT_FRAME_DURATION_MS - 1);
  assert.equal(runtime.frameIndex, 0);
  runtime.tick(1);
  assert.equal(runtime.frameIndex, 1);
  runtime.dispose();
  for (const frame of Object.values(mockAtlas().frames)) assert.deepEqual(frame.anchor, DEFAULT_ANCHOR);

  assert.equal(parseAnchorValue("0", 0.5), 0, "0 is a valid anchor");
  assert.equal(parseAnchorValue("1.4", 0.5), 1);
  assert.equal(parseAnchorValue("", 0.5), 0.5);
  assert.equal(parseAnchorValue("abc", 0.25), 0.25);
});

test("wheel zoom keeps the world point under the cursor and stays within limits", () => {
  const view = { x: 40, y: -20, scale: 1.5 };
  const cursor = { x: 300, y: 210 };
  const world = (v) => [(cursor.x - v.x) / v.scale, (cursor.y - v.y) / v.scale];
  for (const deltaY of [-120, 120]) {
    const next = zoomAround(view, cursor, nextZoomScale(view.scale, deltaY));
    assert.notEqual(next.scale, view.scale);
    world(next).forEach((value, axis) => assert.ok(Math.abs(value - world(view)[axis]) < 1e-9));
  }
  assert.equal(nextZoomScale(ZOOM.max, -1), ZOOM.max);
  assert.equal(nextZoomScale(ZOOM.min, 1), ZOOM.min);
});
