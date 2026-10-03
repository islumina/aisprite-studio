import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getAnimationOutline,
  getGenerationTask,
  getPendingTasks,
  getReferenceTask,
  listAssets,
  parsePng,
  submitFrame,
  submitReference,
} from "../src/workspace.js";

function png(width: number, height: number): Buffer {
  const value = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value);
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  return value;
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "aisprite-studio-mcp-"));
  const dir = path.join(root, "assets", "hero");
  await mkdir(path.join(dir, "frames"), { recursive: true });
  await writeFile(path.join(dir, "request.yml"), [
    "character: hero",
    "style: pixel art",
    "frame_size: 64",
    "asset_type: character",
    "animations:",
    "  - action: idle",
    "    direction: front",
    "    frames: 2",
  ].join("\n"));
  await writeFile(path.join(dir, "tpose.png"), png(64, 64));
  return root;
}

test("lists valid generation assets", async () => {
  const root = await fixture();
  const assets = await listAssets(root);
  assert.equal(assets.length, 1);
  assert.deepEqual(assets[0], {
    name: "hero",
    asset_type: "character",
    frame_size: 64,
    expected_frames: 2,
    generated_frames: 0,
    qa_status: "missing",
    has_reference: true,
  });
});

test("returns the first missing frame with its canonical reference", async () => {
  const root = await fixture();
  const task = await getGenerationTask(root, "hero");
  assert.equal(task.frame.name, "idle_front_00");
  assert.equal(task.reference_paths.length, 1);
  assert.match(task.prompt, /64x64 PNG/);
});

test("marks existing generated references as unapproved and supports explicit repair", async () => {
  const root = await fixture();
  const task = await getReferenceTask(root, "hero");
  assert.match(task.reference_warning, /failure artifacts/);
  assert.equal(task.reference_paths.length, 1);
  await assert.rejects(submitReference(root, "hero", png(64, 64).toString("base64"), false), /already exists/);
  const result = await submitReference(root, "hero", png(64, 64).toString("base64"), true);
  assert.equal(result.path, "assets/hero/tpose.png");
});

test("validates dimensions and refuses accidental overwrite", async () => {
  const root = await fixture();
  await assert.rejects(
    submitFrame(root, "hero", "idle_front_00", png(32, 32).toString("base64"), false),
    /must be 64x64/,
  );
  const result = await submitFrame(root, "hero", "idle_front_00", png(64, 64).toString("base64"), false);
  assert.equal(result.width, 64);
  assert.deepEqual(parsePng(await readFile(path.join(root, result.path))), { width: 64, height: 64 });
  await assert.rejects(
    submitFrame(root, "hero", "idle_front_00", png(64, 64).toString("base64"), false),
    /already exists/,
  );
});

test("rejects undeclared frames and traversal identifiers", async () => {
  const root = await fixture();
  await assert.rejects(getGenerationTask(root, "../hero"), /asset must contain only/);
  await assert.rejects(
    submitFrame(root, "hero", "idle_front_99", png(64, 64).toString("base64"), false),
    /not declared/,
  );
  await assert.rejects(
    submitFrame(root, "hero", "idle_front_00", "not base64====", false),
    /canonical base64/,
  );
});

test("does not follow asset image or frames directory symlinks", async () => {
  const root = await fixture();
  const assetDir = path.join(root, "assets", "hero");
  await rename(path.join(assetDir, "tpose.png"), path.join(assetDir, "original-tpose.png"));
  await symlink("/etc/hosts", path.join(assetDir, "tpose.png"));
  await assert.rejects(getGenerationTask(root, "hero"), /no usable/);

  await rename(path.join(assetDir, "frames"), path.join(assetDir, "original-frames"));
  await symlink(tmpdir(), path.join(assetDir, "frames"));
  await assert.rejects(
    submitFrame(root, "hero", "idle_front_00", png(64, 64).toString("base64"), false),
    /real directory/,
  );
});

test("names frames without a direction and outlines the animation", async () => {
  const root = await fixture();
  const dir = path.join(root, "assets", "fish");
  await mkdir(path.join(dir, "frames"), { recursive: true });
  await writeFile(path.join(dir, "request.yml"), [
    "style: flat",
    "frame_size: 64",
    "asset_type: character",
    "animations:",
    "  - action: swim",
    "    direction: \"\"",
    "    frames: 2",
  ].join("\n"));
  await writeFile(path.join(dir, "tpose.png"), png(64, 64));
  await writeFile(path.join(dir, "frames", "swim_00.png"), png(64, 64));

  const pending = await getPendingTasks(root, "fish");
  assert.deepEqual(pending.map((task) => task.frame.name), ["swim_01"]);
  assert.match(pending[0]!.prompt, /Continue motion from swim_00\.png/);
  assert.equal(pending[0]!.reference_paths.length, 2);

  const outline = await getAnimationOutline(root, "fish", "swim");
  assert.deepEqual(outline.frames.map((frame) => frame.name), ["swim_00", "swim_01"]);
  await assert.rejects(getAnimationOutline(root, "fish", "walk"), /not declared/);
});

test("frame prompts carry the pose and facing for known actions", async () => {
  const root = await fixture();
  const task = await getGenerationTask(root, "hero", "idle_front_01");
  assert.match(task.prompt, /facing the viewer/);
  assert.match(task.prompt, /Pose: slight inhale/);
});
