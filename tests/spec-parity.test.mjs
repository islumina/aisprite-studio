// Python names frames for QA and packing, the MCP server names them for generation and
// submission. Both must agree, or a submitted frame is invisible to QA.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { frameSpecs, loadRequest } from "../mcp-server/dist/workspace.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);

// `request` is a request object, or the path of a request.yml for Python to parse itself.
async function pythonFrames(request) {
  const script = [
    "import json, sys, yaml",
    "from tools.sprite_pipeline.spec import frame_specs",
    "arg = sys.argv[1]",
    "request = json.loads(arg) if arg.startswith('{') else yaml.safe_load(open(arg))",
    "print(json.dumps([[s['name'], s['animation']] for s in frame_specs(request)]))",
  ].join("\n");
  const argument = typeof request === "string" ? request : JSON.stringify(request);
  return JSON.parse((await run("python3", ["-c", script, argument], { cwd: ROOT })).stdout);
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
    const expected = tsFrames(await loadRequest(ROOT, name));
    assert.deepEqual(await pythonFrames(path.join(ROOT, "assets", name, "request.yml")), expected, name);
    for (const [frame] of expected) {
      await access(path.join(ROOT, "assets", name, "frames", `${frame}.png`));
    }
  }
});
