import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { createStudioServer, isAllowedHost, parsePort } from "../server.mjs";
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
  await writeFile(path.join(root, "webeditor", "font.woff2"), "fixture");
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

test("serves self-hosted fonts as font/woff2", async () => {
  const response = await request("/font.woff2");
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "font/woff2");
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

function postJson(pathname, value, headers = {}) {
  const body = JSON.stringify(value);
  return request(pathname, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...headers },
    body,
  });
}

// Smallest valid PNG: 1x1 transparent pixel.
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";

test("rejects malformed keyed images", async () => {
  const body = JSON.stringify({
    char: "hero",
    atlas: { frames: {}, meta: { image: "should-not-be-written.png" } },
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

test("accepts loopback names and IP literals as Host, nothing else", () => {
  for (const host of ["localhost:8080", "127.0.0.1:8080", "[::1]:8080", "studio.localhost", "192.168.1.20:8080"]) {
    assert.equal(isAllowedHost(host), true, host);
  }
  for (const host of [undefined, "", "evil.example:8080", "evil.example@127.0.0.1", "127.0.0.1/x", "[nope]:80", "2130706433"]) {
    assert.equal(isAllowedHost(host), false, String(host));
  }
});

test("refuses requests addressed to a rebound hostname", async () => {
  for (const pathname of ["/", "/api/assets", "/api/agent-config"]) {
    const response = await request(pathname, { headers: { host: "attacker.example:8080" } });
    assert.equal(response.status, 403, pathname);
  }
});

test("refuses cross-site writes", async () => {
  const plain = await request("/api/prompt", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ char: "hero", name: "csrf", text: "bad" }),
  });
  assert.equal(plain.status, 415);

  const crossOrigin = await postJson("/api/prompt", { char: "hero", name: "csrf", text: "bad" }, { origin: "https://evil.example" });
  assert.equal(crossOrigin.status, 403);
  await assert.rejects(readFile(path.join(root, "assets", "hero", "prompts", "csrf.txt")), { code: "ENOENT" });

  const sameOrigin = await postJson("/api/prompt", { char: "hero", name: "same", text: "ok" }, { origin: baseUrl });
  assert.equal(sameOrigin.status, 200);
});

test("saves the atlas with or without a keyed export", async () => {
  const atlas = { frames: { idle_00: { frame: { x: 0, y: 0, w: 1, h: 1 } } }, meta: { image: "hero.webp" } };
  const withoutKeyed = await postJson("/api/save", { char: "hero", prefix: "output", atlas, keyedImage: null });
  assert.equal(withoutKeyed.status, 200);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "assets", "hero", "output", "atlas.json"), "utf8")), atlas);

  const withKeyed = await postJson("/api/save", {
    char: "hero",
    prefix: "output",
    atlas,
    keyedImage: `data:image/png;base64,${PNG_1X1}`,
  });
  assert.equal(withKeyed.status, 200);
  const keyed = await readFile(path.join(root, "assets", "hero", "output", "hero_keyed.png"));
  assert.equal(keyed.toString("base64"), PNG_1X1);

  const shapeless = await postJson("/api/save", { char: "hero", atlas: { meta: {} } });
  assert.equal(shapeless.status, 400);
});

test("does not read prompts through symlinks", async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "aisprite-studio-prompt-"));
  await writeFile(path.join(outside, "secret.txt"), "secret");
  await mkdir(path.join(root, "assets", "hero", "prompts"), { recursive: true });
  await symlink(path.join(outside, "secret.txt"), path.join(root, "assets", "hero", "prompts", "leak.txt"));
  const response = await request("/api/prompt?char=hero&name=leak");
  assert.deepEqual(JSON.parse(response.body), { exists: false, text: "" });

  const real = await request("/api/prompt?char=hero&name=idle_front");
  assert.deepEqual(JSON.parse(real.body), { exists: true, text: "Generate idle." });
});

test("caps asset identifiers at 64 characters", async () => {
  const response = await request(`/api/status?char=${"a".repeat(65)}`);
  assert.equal(response.status, 400);
});
