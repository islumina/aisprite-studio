import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { createStudioServer, parsePort } from "../server.mjs";
import { normaliseStudioCommand } from "../webeditor/src/host-bridge.js";

let root;
let server;
let baseUrl;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(`${baseUrl}${pathname}`, options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "aisprite-studio-server-"));
  await mkdir(path.join(root, "webeditor"), { recursive: true });
  await mkdir(path.join(root, "assets", "hero", "output"), { recursive: true });
  await mkdir(path.join(root, "mcp-server", "dist"), { recursive: true });
  await writeFile(path.join(root, "webeditor", "index.html"), "<!doctype html><title>studio</title>");
  await writeFile(path.join(root, "assets", "hero", "tpose.png"), "fixture");
  await writeFile(path.join(root, "assets", "hero", "output", "sheet.png"), "fixture");
  await writeFile(path.join(root, "assets", "hero", "output", "atlas.json"), JSON.stringify({ meta: { image: "sheet.png" } }));
  await writeFile(path.join(root, "mcp-server", "dist", "index.js"), "// fixture");
  server = createStudioServer({ projectRoot: root });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("serves the editor and reports declared assets", async () => {
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /studio/);
  assert.match(page.headers["cache-control"], /no-store/);

  const response = await request("/api/assets");
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), [{
    name: "hero",
    hasAtlas: true,
    hasSheet: true,
    atlasPrefix: "output",
    hasReference: true,
  }]);
});

test("blocks static path traversal", async () => {
  const response = await request("/%2e%2e/server.mjs");
  assert.equal(response.status, 404);
});

test("does not follow static or writable directory symlinks", async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "aisprite-studio-outside-"));
  await writeFile(path.join(outside, "secret.txt"), "secret");
  await symlink(outside, path.join(root, "webeditor", "linked"));
  const staticResponse = await request("/linked/secret.txt");
  assert.equal(staticResponse.status, 404);

  await symlink(outside, path.join(root, "assets", "linked-asset"));
  const body = JSON.stringify({ char: "linked-asset", name: "escape", text: "bad" });
  const writeResponse = await request("/api/prompt", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body,
  });
  assert.equal(writeResponse.status, 400);
});

test("validates API identifiers and writes prompts atomically", async () => {
  const invalidBody = JSON.stringify({ char: "../hero", name: "idle", text: "bad" });
  const invalid = await request("/api/prompt", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(invalidBody) },
    body: invalidBody,
  });
  assert.equal(invalid.status, 400);

  const body = JSON.stringify({ char: "hero", name: "idle/front", text: "Generate idle." });
  const saved = await request("/api/prompt", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body,
  });
  assert.equal(saved.status, 200);
  assert.equal(await readFile(path.join(root, "assets", "hero", "prompts", "idle_front.txt"), "utf8"), "Generate idle.");
});

test("rejects malformed keyed images", async () => {
  const body = JSON.stringify({
    char: "hero",
    atlas: { meta: { image: "should-not-be-written.png" } },
    keyedImage: "data:image/png;base64,bm90IGEgcG5n",
  });
  const response = await request("/api/save", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body,
  });
  assert.equal(response.status, 400);
  await assert.rejects(readFile(path.join(root, "assets", "hero", "atlas.json")), { code: "ENOENT" });
});

test("returns local MCP handoff configuration", async () => {
  const response = await request("/api/agent-config");
  assert.equal(response.status, 200);
  const config = JSON.parse(response.body);
  assert.equal(config.ok, true);
  assert.equal(config.config.mcpServers["aisprite-studio"].env.AISPRITE_STUDIO_ROOT, root);
  assert.match(config.codexToml, /mcp_servers\.aisprite-studio/);
});

test("validates configured ports", () => {
  assert.equal(parsePort("8080"), 8080);
  assert.throws(() => parsePort("abc"), /integer/);
  assert.throws(() => parsePort("65536"), /between/);
});

test("validates host bridge commands at the iframe boundary", () => {
  assert.deepEqual(normaliseStudioCommand({ type: "select-asset", asset: "hero_01" }), {
    type: "select-asset",
    asset: "hero_01",
  });
  assert.deepEqual(normaliseStudioCommand({ type: "request-context", ignored: true }), { type: "request-context" });
  assert.equal(normaliseStudioCommand({ type: "select-asset", asset: "../hero" }), null);
  assert.equal(normaliseStudioCommand({ type: "write-file" }), null);
});
