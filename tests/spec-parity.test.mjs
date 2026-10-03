// Python names frames for QA and packing, the MCP server names them for generation and
// submission. Both must agree, or a submitted frame is invisible to QA.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parse } from "yaml";

import { frameSpecs, loadRequest } from "../mcp-server/dist/workspace.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);

async function pythonFrames(request) {
  const script = [
    "import json, sys",
    "from tools.sprite_pipeline.spec import frame_specs",
    "print(json.dumps([[s['name'], s['animation']] for s in frame_specs(json.load(sys.stdin))]))",
  ].join("\n");
  const child = run("python3", ["-c", script], { cwd: ROOT });
  child.child.stdin.end(JSON.stringify(request));
  return JSON.parse((await child).stdout);
}

const tsFrames = (request) => frameSpecs(request).map((frame) => [frame.name, frame.animation]);

test("Python and the MCP server name the same frames", async () => {
  const request = {
    style: "test",
    frame_size: 64,
    asset_type: "character",
    animations: [
      { action: "idle", direction: "front", frames: 3 },
      { action: "swim", direction: "", frames: 2 },
      { action: "walk", direction: "left_up", frames: 12 },
    ],
  };
  assert.deepEqual(await pythonFrames(request), tsFrames(request));
});

test("every bundled request resolves to the same, existing frames in both", async () => {
  const assets = (await readdir(path.join(ROOT, "assets"), { withFileTypes: true })).filter((entry) => entry.isDirectory());
  assert.ok(assets.length > 0);
  for (const { name } of assets) {
    const raw = parse(await readFile(path.join(ROOT, "assets", name, "request.yml"), "utf8"));
    const request = await loadRequest(ROOT, name);
    const expected = tsFrames(request);
    assert.deepEqual(await pythonFrames(raw), expected, name);
    for (const [frame] of expected) {
      await access(path.join(ROOT, "assets", name, "frames", `${frame}.png`));
    }
  }
});
