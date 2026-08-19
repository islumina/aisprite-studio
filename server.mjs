#!/usr/bin/env node

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ASSET_ID = /^[A-Za-z0-9_-]+$/;
const SAFE_FILE = /[^A-Za-z0-9_.-]/g;
const MAX_BODY_BYTES = 30 * 1024 * 1024;
const MAX_PNG_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".yml", "text/yaml; charset=utf-8"],
  [".yaml", "text/yaml; charset=utf-8"],
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAssetId(value) {
  return typeof value === "string" && ASSET_ID.test(value);
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function noCacheHeaders() {
  return {
    "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
    pragma: "no-cache",
    expires: "0",
    etag: `"${randomUUID().replaceAll("-", "")}"`,
  };
}

function sendJson(response, value, status = 200) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    ...noCacheHeaders(),
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
  });
  response.end(body);
}

function sendError(response, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const message = status >= 500 ? "Internal server error" : error.message;
  if (status >= 500) console.error(error);
  sendJson(response, { ok: false, error: message }, status);
}

async function readJsonBody(request) {
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) throw new HttpError(400, "Invalid Content-Length");
    if (Number(contentLength) > MAX_BODY_BYTES) throw new HttpError(413, "Payload Too Large");
  }

  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > MAX_BODY_BYTES) throw new HttpError(413, "Payload Too Large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function safeResolve(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new HttpError(404, "Not found");
  }
  return resolved;
}

async function atomicWrite(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.studio-${process.pid}-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function ensureContainedDirectory(root, segments) {
  let current = path.resolve(root);
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new HttpError(400, `${segment} must be a real directory`);
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error.code !== "ENOENT") throw error;
      await mkdir(current);
    }
  }
  return current;
}

function decodePngDataUrl(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,")) {
    throw new HttpError(400, "keyedImage must be a PNG data URL");
  }
  const encoded = value.slice("data:image/png;base64,".length);
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new HttpError(400, "keyedImage must contain canonical base64 data");
  }
  if (encoded.length > Math.ceil(MAX_PNG_BYTES * 4 / 3) + 8) {
    throw new HttpError(413, "PNG exceeds the 20 MiB limit");
  }
  const png = Buffer.from(encoded, "base64");
  if (png.length > MAX_PNG_BYTES) throw new HttpError(413, "PNG exceeds the 20 MiB limit");
  if (png.length < 24 || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new HttpError(400, "keyedImage is not a valid PNG");
  }
  return png;
}

async function findOnPath(command) {
  const pathValue = process.env.PATH ?? "";
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return undefined;
}

async function compressWebp(pngPath, webpPath) {
  const cwebp = await findOnPath("cwebp");
  if (!cwebp) return;
  const temporary = `${webpPath}.studio-${process.pid}-${randomUUID()}.tmp`;
  try {
    await execFileAsync(cwebp, ["-q", "90", pngPath, "-o", temporary], {
      timeout: 30_000,
      maxBuffer: 256 * 1024,
    });
    await rename(temporary, webpPath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    console.error(`cwebp keyed image compression failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function listAssets(projectRoot) {
  const assetsDirectory = path.join(projectRoot, "assets");
  let entries;
  try {
    entries = await readdir(assetsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !isAssetId(entry.name)) continue;
    const directory = path.join(assetsDirectory, entry.name);
    let atlasPrefix = null;
    if (await isFile(path.join(directory, "output", "atlas.json"))) atlasPrefix = "output";
    else if (await isFile(path.join(directory, "atlas.json"))) atlasPrefix = "";

    let hasSheet = false;
    if (atlasPrefix !== null) {
      const atlasDirectory = path.join(directory, atlasPrefix);
      try {
        const atlas = JSON.parse(await readFile(path.join(atlasDirectory, "atlas.json"), "utf8"));
        const image = isObject(atlas.meta) && typeof atlas.meta.image === "string" ? path.basename(atlas.meta.image) : "sheet.png";
        hasSheet = await isFile(path.join(atlasDirectory, image));
      } catch {
        hasSheet = await isFile(path.join(atlasDirectory, `${entry.name}.png`))
          || await isFile(path.join(atlasDirectory, "sheet.png"));
      }
    }
    result.push({
      name: entry.name,
      hasAtlas: atlasPrefix !== null,
      hasSheet,
      atlasPrefix: atlasPrefix ?? "",
      hasReference: await isFile(path.join(directory, "tpose.png")) || await isFile(path.join(directory, "input.png")),
    });
  }
  return result;
}

async function assetStatus(projectRoot, asset) {
  const base = path.join(projectRoot, "assets", asset);
  const atlasPrefix = await isFile(path.join(base, "output", "atlas.json")) ? "output" : "";
  const atlasPath = path.join(base, atlasPrefix, "atlas.json");
  let image = "sheet.png";
  try {
    const atlas = JSON.parse(await readFile(atlasPath, "utf8"));
    image = isObject(atlas.meta) && typeof atlas.meta.image === "string" ? path.basename(atlas.meta.image) : image;
  } catch {
    image = `${asset}.png`;
  }
  const modified = async (filePath) => await isFile(filePath) ? (await stat(filePath)).mtimeMs / 1000 : 0;
  return {
    char: asset,
    atlasMtime: await modified(atlasPath),
    sheetMtime: await modified(path.join(base, atlasPrefix, image)),
  };
}

async function saveEditorOutput(projectRoot, data) {
  if (!isObject(data) || !isAssetId(data.char)) throw new HttpError(400, "Invalid char parameter");
  if (data.prefix !== undefined && data.prefix !== "" && !isAssetId(data.prefix)) {
    throw new HttpError(400, "Invalid prefix parameter");
  }
  if (data.atlas !== undefined && !isObject(data.atlas)) throw new HttpError(400, "atlas must be a JSON object");

  const directorySegments = ["assets", data.char, ...(data.prefix ? [data.prefix] : [])];
  const targetDirectory = await ensureContainedDirectory(projectRoot, directorySegments);
  let keyedOutput;
  if (data.keyedImage !== undefined) {
    const png = decodePngDataUrl(data.keyedImage);
    const configuredName = isObject(data.atlas?.meta) && typeof data.atlas.meta.image === "string"
      ? data.atlas.meta.image
      : `${data.char}.png`;
    const safeName = path.basename(configuredName).replaceAll(SAFE_FILE, "_");
    const stem = path.parse(safeName).name || data.char;
    keyedOutput = { png, stem };
  }
  if (data.atlas !== undefined) {
    await atomicWrite(path.join(targetDirectory, "atlas.json"), `${JSON.stringify(data.atlas, null, 2)}\n`);
  }
  if (keyedOutput) {
    const pngPath = path.join(targetDirectory, `${keyedOutput.stem}_keyed.png`);
    await atomicWrite(pngPath, keyedOutput.png);
    await compressWebp(pngPath, path.join(targetDirectory, `${keyedOutput.stem}_keyed.webp`));
  }
}

async function serveStatic(request, response, projectRoot, webeditorRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "Invalid URL encoding");
  }
  const relative = decoded.replace(/^\/+/, "");
  const shared = relative === "assets" || relative.startsWith("assets/")
    || relative === "prompts" || relative.startsWith("prompts/");
  const root = shared ? projectRoot : webeditorRoot;
  const requested = relative === "" ? "index.html" : relative;
  let filePath = safeResolve(root, requested);
  try {
    if ((await stat(filePath)).isDirectory()) filePath = safeResolve(root, path.join(requested, "index.html"));
  } catch {
    throw new HttpError(404, "Not found");
  }
  if (!await isFile(filePath)) throw new HttpError(404, "Not found");
  const canonicalRoot = await realpath(root);
  const canonicalFile = await realpath(filePath);
  if (canonicalFile !== canonicalRoot && !canonicalFile.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new HttpError(404, "Not found");
  }
  filePath = canonicalFile;
  const info = await stat(filePath);
  response.writeHead(200, {
    ...noCacheHeaders(),
    "content-type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream",
    "content-length": info.size,
  });
  if (request.method === "HEAD") return response.end();
  const stream = createReadStream(filePath);
  stream.on("error", (error) => response.destroy(error));
  stream.pipe(response);
}

function isLocalAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function createStudioServer({ projectRoot = MODULE_ROOT } = {}) {
  const resolvedRoot = path.resolve(projectRoot);
  const webeditorRoot = path.join(resolvedRoot, "webeditor");
  return http.createServer({ requestTimeout: 30_000 }, async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/api/assets") {
        return sendJson(response, await listAssets(resolvedRoot));
      }
      if (request.method === "GET" && url.pathname === "/api/status") {
        const asset = url.searchParams.get("char");
        if (!isAssetId(asset)) throw new HttpError(400, "Invalid char parameter");
        return sendJson(response, await assetStatus(resolvedRoot, asset));
      }
      if (request.method === "GET" && url.pathname === "/api/prompt") {
        const asset = url.searchParams.get("char");
        if (!isAssetId(asset)) return sendJson(response, { exists: false, text: "" });
        const safeName = (url.searchParams.get("name") ?? "").replaceAll(SAFE_FILE, "_");
        if (!safeName) return sendJson(response, { exists: false, text: "" });
        const filename = safeName.endsWith(".txt") ? safeName : `${safeName}.txt`;
        const promptPath = path.join(resolvedRoot, "assets", asset, "prompts", filename);
        try {
          return sendJson(response, { exists: true, text: await readFile(promptPath, "utf8") });
        } catch {
          return sendJson(response, { exists: false, text: "" });
        }
      }
      if (request.method === "GET" && url.pathname === "/api/agent-config") {
        if (!isLocalAddress(request.socket.remoteAddress)) throw new HttpError(403, "Agent config is available only from localhost.");
        const entrypoint = path.join(resolvedRoot, "mcp-server", "dist", "index.js");
        return sendJson(response, {
          ok: await isFile(entrypoint),
          buildCommand: "cd mcp-server && npm install && npm run check",
          codexToml: `[mcp_servers.aiplaybook]\ncommand = "node"\nargs = [${JSON.stringify(entrypoint)}]\n\n[mcp_servers.aiplaybook.env]\nAIPLAYBOOK_ROOT = ${JSON.stringify(resolvedRoot)}\n`,
          config: { mcpServers: { aiplaybook: { command: "node", args: [entrypoint], env: { AIPLAYBOOK_ROOT: resolvedRoot } } } },
        });
      }
      if (request.method === "POST" && url.pathname === "/api/prompt") {
        const data = await readJsonBody(request);
        if (!isObject(data) || !isAssetId(data.char)) throw new HttpError(400, "Invalid char parameter");
        const safeName = String(data.name ?? "").replaceAll(SAFE_FILE, "_");
        if (!safeName) throw new HttpError(400, "char and name required");
        if (typeof data.text !== "string") throw new HttpError(400, "text must be a string");
        const filename = safeName.endsWith(".txt") ? safeName : `${safeName}.txt`;
        const promptDirectory = await ensureContainedDirectory(resolvedRoot, ["assets", data.char, "prompts"]);
        const promptPath = path.join(promptDirectory, filename);
        await atomicWrite(promptPath, data.text);
        return sendJson(response, { ok: true, path: path.relative(resolvedRoot, promptPath) });
      }
      if (request.method === "POST" && url.pathname === "/api/save") {
        await saveEditorOutput(resolvedRoot, await readJsonBody(request));
        return sendJson(response, { ok: true });
      }
      if (request.method === "GET" || request.method === "HEAD") {
        return await serveStatic(request, response, resolvedRoot, webeditorRoot, url.pathname);
      }
      throw new HttpError(404, "Unknown endpoint");
    } catch (error) {
      sendError(response, error);
    }
  });
}

export function parsePort(value) {
  if (!/^\d+$/.test(value)) throw new Error("AIPLAYBOOK_PORT must be an integer");
  const port = Number(value);
  if (port < 1 || port > 65_535) throw new Error("AIPLAYBOOK_PORT must be between 1 and 65535");
  return port;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const host = process.env.AIPLAYBOOK_HOST ?? "127.0.0.1";
  const port = parsePort(process.env.AIPLAYBOOK_PORT ?? "8080");
  const server = createStudioServer();
  server.listen(port, host, () => console.log(`Dev server on http://${host}:${port} (no-cache)`));
}
