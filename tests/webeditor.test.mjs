import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normaliseAtlas,
  resolvePlayback,
  setDuration,
  setFrameDuration,
  summariseFrameDurations,
} from "../webeditor/src/atlas-model.js";
import { bus, EV } from "../webeditor/src/bus.js";
import { allowedParentOrigin } from "../webeditor/src/host-bridge.js";
import { resolveStudioMode } from "../webeditor/src/mode.js";

// Same timing shape as webeditor/src/mock.js: fps implies 167 ms, but every frame stores 150 ms.
function demoAtlas() {
  const cell = () => ({ frame: { x: 0, y: 0, w: 128, h: 128 }, duration: 150 });
  return normaliseAtlas({
    assetType: "character",
    frames: { idle_00: cell(), idle_01: cell(), hit_00: cell() },
    animations: { idle: ["idle_00", "idle_01"], hit: ["hit_00"] },
    animationConfig: { idle: { onEnd: "loop", fps: 6 }, hit: { onEnd: "idle", fps: 8 } },
    states: {
      initial: "idle",
      definitions: {
        idle: { animation: "idle", loop: true, onEnd: "loop", transitions: { DAMAGE: { target: "hit" } } },
        hit: { animation: "hit", loop: false, onEnd: "idle", transitions: {} },
      },
    },
  });
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

test("selects local mode only on a loopback host without ?mode=static", () => {
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(resolveStudioMode({ hostname, search: "" }), "local", hostname);
    assert.equal(resolveStudioMode({ hostname, search: "?char=reimu" }), "local", hostname);
    assert.equal(resolveStudioMode({ hostname, search: "?mode=static" }), "static", hostname);
  }
  for (const hostname of ["islumina.org", "www.islumina.org", "localhost.example.com", "192.168.1.20", "0.0.0.0", ""]) {
    assert.equal(resolveStudioMode({ hostname, search: "" }), "static", hostname);
    assert.equal(resolveStudioMode({ hostname, search: "?mode=local" }), "static", hostname);
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
