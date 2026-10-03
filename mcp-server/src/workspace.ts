import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "yaml";
import * as z from "zod/v4";

import { REFERENCE_WARNING, animationPrompt, framePrompt, poseFor, referencePrompt, rowPrompt, type RowLayout } from "./prompts.js";
import { ASSET_ID, RequestSchema, frameName, frameSpecs, type AssetRequest, type FrameSpec } from "./request.js";

export { animationName, frameName, frameSpecs, type AssetRequest, type FrameSpec } from "./request.js";
export { poseFor, type RowLayout } from "./prompts.js";
const FRAME_ID = /^[A-Za-z0-9_-]{1,160}$/;
const MAX_PNG_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface AssetSummary {
  name: string;
  asset_type: AssetRequest["asset_type"];
  frame_size: number;
  expected_frames: number;
  generated_frames: number;
  qa_status: string;
  has_reference: boolean;
}

export interface GenerationTask {
  asset: string;
  frame: FrameSpec;
  request: AssetRequest;
  prompt: string;
  reference_paths: string[];
}

export interface AnimationOutline {
  asset: string;
  animation: string;
  frames: { name: string; pose: string }[];
  prompt: string;
}

export interface RowTask {
  asset: string;
  animation: string;
  frames: string[];
  layout: RowLayout;
  upscale: number;
  warning: string | null;
  prompt: string;
  reference_paths: string[];
}

export interface ReferenceTask {
  asset: string;
  request: AssetRequest;
  prompt: string;
  reference_paths: string[];
  known_asset_status: string;
  reference_warning: string;
}

function safeId(value: string, label: string, pattern: RegExp = ASSET_ID): string {
  if (!pattern.test(value)) throw new Error(`${label} must contain only letters, numbers, underscore, or hyphen.`);
  return value;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await lstat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(directoryPath: string): Promise<boolean> {
  try {
    return (await lstat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

async function ensureDirectory(directoryPath: string): Promise<void> {
  try {
    if (!(await lstat(directoryPath)).isDirectory()) throw new Error(`${directoryPath} must be a real directory, not a symlink.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(directoryPath, { recursive: true });
  }
}

async function assertDirectoryIfPresent(directoryPath: string, label: string): Promise<void> {
  try {
    if (!(await lstat(directoryPath)).isDirectory()) throw new Error(`${label} must be a real directory, not a symlink.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function assetDirectory(root: string, asset: string): string {
  return path.join(root, "assets", safeId(asset, "asset"));
}

export async function loadRequest(root: string, asset: string): Promise<AssetRequest> {
  const directory = assetDirectory(root, asset);
  if (!await isDirectory(directory)) throw new Error(`Asset '${asset}' must be a real directory, not a symlink.`);
  const requestPath = path.join(directory, "request.yml");
  let source: string;
  try {
    const info = await lstat(requestPath);
    if (!info.isFile() || info.size > 256 * 1024) throw new Error("request.yml must be a regular file no larger than 256 KiB.");
    source = await readFile(requestPath, "utf8");
  } catch {
    throw new Error(`Asset '${asset}' has no readable request.yml.`);
  }
  return RequestSchema.parse(parse(source));
}

async function qaStatus(assetDir: string): Promise<string> {
  try {
    const reportPath = path.join(assetDir, "qa-report.json");
    if (!await isFile(reportPath)) return "missing";
    const value: unknown = JSON.parse(await readFile(reportPath, "utf8"));
    if (value && typeof value === "object" && "overall" in value && typeof value.overall === "string") {
      return value.overall;
    }
    return "invalid";
  } catch {
    return "missing";
  }
}

export async function listAssets(root: string): Promise<AssetSummary[]> {
  const entries = await readdir(path.join(root, "assets"), { withFileTypes: true });
  const assets: AssetSummary[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !ASSET_ID.test(entry.name)) continue;
    try {
      const request = await loadRequest(root, entry.name);
      const specs = frameSpecs(request);
      const dir = assetDirectory(root, entry.name);
      const generated = await Promise.all(specs.map((frame) => isFile(path.join(dir, "frames", `${frame.name}.png`))));
      assets.push({
        name: entry.name,
        asset_type: request.asset_type,
        frame_size: request.frame_size,
        expected_frames: specs.length,
        generated_frames: generated.filter(Boolean).length,
        qa_status: await qaStatus(dir),
        has_reference: await isFile(path.join(dir, "tpose.png")) || await isFile(path.join(dir, "input.png")),
      });
    } catch {
      // Directories without a valid request are not generation workspaces.
    }
  }
  return assets;
}

export async function getReferenceTask(root: string, asset: string): Promise<ReferenceTask> {
  const request = await loadRequest(root, asset);
  const dir = assetDirectory(root, asset);
  const candidates = [path.join(dir, "input.png"), path.join(dir, "tpose.png")];
  const references: string[] = [];
  for (const candidate of candidates) {
    if (await isFile(candidate)) references.push(candidate);
  }
  return {
    asset,
    request,
    known_asset_status: await qaStatus(dir),
    reference_warning: REFERENCE_WARNING,
    reference_paths: references,
    prompt: referencePrompt(asset, request),
  };
}

export async function getGenerationTask(root: string, asset: string, requestedFrame?: string): Promise<GenerationTask> {
  const request = await loadRequest(root, asset);
  const specs = frameSpecs(request);
  let frame: FrameSpec | undefined;
  if (requestedFrame) {
    safeId(requestedFrame, "frame", FRAME_ID);
    frame = specs.find((candidate) => candidate.name === requestedFrame);
    if (!frame) throw new Error(`Frame '${requestedFrame}' is not declared in ${asset}/request.yml.`);
  } else {
    for (const candidate of specs) {
      if (!await isFile(path.join(assetDirectory(root, asset), "frames", `${candidate.name}.png`))) {
        frame = candidate;
        break;
      }
    }
  }
  if (!frame) throw new Error(`Asset '${asset}' has no missing frames. Specify a declared frame to repair it.`);

  const dir = assetDirectory(root, asset);
  const framesDir = path.join(dir, "frames");
  await assertDirectoryIfPresent(framesDir, `Asset '${asset}' frames path`);
  const candidates = [
    path.join(dir, "tpose.png"),
    path.join(dir, "input.png"),
    frame.index > 0 ? path.join(dir, "frames", `${frameName(frame.action, frame.direction, 0)}.png`) : "",
    frame.index > 0 ? path.join(dir, "frames", `${frameName(frame.action, frame.direction, frame.index - 1)}.png`) : "",
  ].filter(Boolean);
  const references: string[] = [];
  for (const candidate of candidates) {
    if (references.length === 3) break;
    if (await isFile(candidate) && !references.includes(candidate)) references.push(candidate);
  }
  if (references.length === 0) {
    throw new Error(`Asset '${asset}' has no usable tpose.png, input.png, or continuity frame.`);
  }

  return { asset, frame, request, prompt: framePrompt(asset, request, frame), reference_paths: references };
}

export async function getAnimationOutline(root: string, asset: string, animation: string): Promise<AnimationOutline> {
  const request = await loadRequest(root, asset);
  const frames = frameSpecs(request).filter((frame) => frame.animation === animation);
  if (frames.length === 0) throw new Error(`Animation '${animation}' is not declared in ${asset}/request.yml.`);
  return {
    asset,
    animation,
    frames: frames.map((frame) => ({ name: frame.name, pose: poseFor(frame) })),
    prompt: animationPrompt(asset, request, frames),
  };
}

export async function getPendingTasks(root: string, asset: string): Promise<GenerationTask[]> {
  const request = await loadRequest(root, asset);
  const tasks: GenerationTask[] = [];
  for (const frame of frameSpecs(request)) {
    if (!await isFile(path.join(assetDirectory(root, asset), "frames", `${frame.name}.png`))) {
      tasks.push(await getGenerationTask(root, asset, frame.name));
    }
  }
  return tasks;
}

export function parsePng(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Submitted data is not a valid PNG file.");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1) throw new Error("PNG dimensions are invalid.");
  return { width, height };
}

export async function submitFrame(root: string, asset: string, frameName: string, encoded: string, replace: boolean): Promise<{ path: string; bytes: number; width: number; height: number }> {
  const request = await loadRequest(root, asset);
  safeId(frameName, "frame", FRAME_ID);
  if (!frameSpecs(request).some((frame) => frame.name === frameName)) {
    throw new Error(`Frame '${frameName}' is not declared in ${asset}/request.yml.`);
  }
  const target = path.join(assetDirectory(root, asset), "frames", `${frameName}.png`);
  return savePng(root, target, encoded, request.frame_size, replace, `Frame '${frameName}'`);
}

// `frameSize` null accepts any size from 64 to 4096 px per side (a row picture).
async function savePng(root: string, target: string, encoded: string, frameSize: number | null, replace: boolean, label: string): Promise<{ path: string; bytes: number; width: number; height: number }> {
  const payload = encoded.replace(/^data:image\/png;base64,/, "");
  if (payload.length > Math.ceil(MAX_PNG_BYTES * 4 / 3) + 8) throw new Error("PNG exceeds the 20 MiB limit.");
  if (payload.length === 0 || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    throw new Error("PNG payload must be canonical base64 data.");
  }
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length > MAX_PNG_BYTES) throw new Error("PNG exceeds the 20 MiB limit.");
  const dimensions = parsePng(buffer);
  if (frameSize === null) {
    if (Math.min(dimensions.width, dimensions.height) < 64 || Math.max(dimensions.width, dimensions.height) > 4096) {
      throw new Error(`Row PNG sides must be 64-4096 px; received ${dimensions.width}x${dimensions.height}.`);
    }
  } else if (dimensions.width !== frameSize || dimensions.height !== frameSize) {
    throw new Error(`PNG must be ${frameSize}x${frameSize}; received ${dimensions.width}x${dimensions.height}.`);
  }

  await ensureDirectory(path.dirname(target));
  if (!replace) {
    try {
      await writeFile(target, buffer, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`${label} already exists. Set replace=true only for an intentional repair.`);
      }
      throw error;
    }
    return { path: path.relative(root, target), bytes: buffer.length, ...dimensions };
  }
  const temporary = `${target}.agent-${process.pid}.tmp`;
  await writeFile(temporary, buffer, { flag: "wx" });
  await rename(temporary, target);
  return { path: path.relative(root, target), bytes: buffer.length, ...dimensions };
}

export async function submitReference(root: string, asset: string, encoded: string, replace: boolean): Promise<{ path: string; bytes: number; width: number; height: number }> {
  const request = await loadRequest(root, asset);
  const target = path.join(assetDirectory(root, asset), "tpose.png");
  return savePng(root, target, encoded, request.frame_size, replace, `Reference '${asset}/tpose.png'`);
}

const ROW_UPSCALE_LIMIT = 1.25;

function animationFrames(request: AssetRequest, asset: string, animation: string): FrameSpec[] {
  const frames = frameSpecs(request).filter((frame) => frame.animation === animation);
  if (frames.length === 0) throw new Error(`Animation '${animation}' is not declared in ${asset}/request.yml.`);
  return frames;
}

export async function getRowTask(root: string, asset: string, requestedAnimation?: string): Promise<RowTask> {
  const request = await loadRequest(root, asset);
  const dir = assetDirectory(root, asset);
  let animation = requestedAnimation;
  if (animation) {
    safeId(animation, "animation", FRAME_ID);
  } else {
    for (const frame of frameSpecs(request)) {
      if (!await isFile(path.join(dir, "frames", `${frame.name}.png`))) {
        animation = frame.animation;
        break;
      }
    }
  }
  if (!animation) throw new Error(`Asset '${asset}' has no missing frames. Specify a declared animation to redo it.`);
  const frames = animationFrames(request, asset, animation);

  await assertDirectoryIfPresent(path.join(dir, "raw"), `Asset '${asset}' raw path`);
  const result = await runPipeline(root, ["row-guide", path.join("assets", asset), animation], 30_000);
  if (result.exit_code !== 0) throw new Error(result.output.trim() || `row-guide exited ${result.exit_code}`);
  const guide = JSON.parse(result.output) as { guide: string; layout: RowLayout; pose_px: number; upscale: number };

  const references: string[] = [];
  for (const candidate of [path.join(dir, "tpose.png"), path.join(dir, "input.png")]) {
    if (await isFile(candidate)) {
      references.push(candidate);
      break;
    }
  }
  if (references.length === 0) throw new Error(`Asset '${asset}' has no usable tpose.png or input.png.`);
  references.push(path.join(root, guide.guide));

  return {
    asset,
    animation,
    frames: frames.map((frame) => frame.name),
    layout: guide.layout,
    upscale: guide.upscale,
    warning: guide.upscale > ROW_UPSCALE_LIMIT
      ? `Each pose is drawn at about ${guide.pose_px}px and enlarged ${guide.upscale}x to ${request.frame_size}px. Prefer per-frame tasks for this asset, or a smaller frame_size.`
      : null,
    prompt: rowPrompt(asset, request, frames, guide.layout),
    reference_paths: references,
  };
}

export async function submitRow(root: string, asset: string, animation: string, encoded: string, replace: boolean): Promise<{ raw: string; frames: string[]; scale: number }> {
  const request = await loadRequest(root, asset);
  safeId(animation, "animation", FRAME_ID);
  animationFrames(request, asset, animation);
  const target = path.join(assetDirectory(root, asset), "raw", `${animation}.png`);
  // The row picture is the source of truth for these frames, so it is always replaced.
  const saved = await savePng(root, target, encoded, null, true, `Row '${asset}/raw/${animation}.png'`);
  const args = ["extract-row", path.join("assets", asset), animation, ...(replace ? ["--replace"] : [])];
  const result = await runPipeline(root, args, 60_000);
  if (result.exit_code !== 0) throw new Error(result.output.trim() || `extract-row exited ${result.exit_code}`);
  const report = JSON.parse(result.output) as { frames: string[]; scale: number };
  return { raw: saved.path, frames: report.frames, scale: report.scale };
}

async function runPipeline(root: string, args: string[], timeoutMs: number): Promise<{ exit_code: number; output: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("python3", ["-m", "tools.sprite_pipeline.cli", ...args], {
      cwd: root,
      env: { ...process.env, PYTHONPYCACHEPREFIX: path.join(tmpdir(), "aisprite-studio-mcp-pycache") },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8").slice(-4_000);
      resolve({ exit_code: code ?? 1, output: code === 0 ? out : err || out });
    });
  });
}

const QA_TIMEOUT_MS = 60_000;
const QA_OUTPUT_CHARS = 25_000;

export async function runDeterministicQa(root: string, asset: string): Promise<{ exit_code: number; output: string }> {
  await loadRequest(root, asset);
  await assertDirectoryIfPresent(path.join(assetDirectory(root, asset), "frames"), `Asset '${asset}' frames path`);
  const result = await runPipeline(root, ["qa", path.join("assets", asset), "--skip-vision"], QA_TIMEOUT_MS);
  return { exit_code: result.exit_code, output: result.output.slice(0, QA_OUTPUT_CHARS) };
}

// Only the fields the summary reads; the rest of qa-report.json passes through untouched.
const QaReportSchema = z.object({
  overall: z.string(),
  score: z.number().optional(),
  animations: z.record(z.string(), z.object({
    score: z.number(),
    hints: z.array(z.string()).default([]),
  }).passthrough()).default({}),
  frames: z.record(z.string(), z.object({
    status: z.string(),
    repair_hint: z.string().nullable().optional(),
  }).passthrough()).default({}),
}).passthrough();

const SUMMARY_HINTS_PER_ANIMATION = 5;
const SUMMARY_FAILING_FRAMES = 40;

export interface QaSummary {
  overall: string;
  score: number | null;
  animations: Record<string, { score: number; hints: string[]; more_hints: number }>;
  failing_frames: { frame: string; status: string; repair_hint: string | null }[];
  failing_frame_count: number;
  visual_review: string;
}

// Compact view of qa-report.json for an agent: what failed and what to redraw.
export function summariseQaReport(report: unknown): QaSummary {
  const parsed = QaReportSchema.safeParse(report);
  if (!parsed.success) throw new Error(`qa-report.json has an unexpected shape: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  const { overall, score, animations, frames } = parsed.data;
  const failing = Object.entries(frames)
    .filter(([, frame]) => frame.status === "fail")
    .map(([frame, value]) => ({ frame, status: value.status, repair_hint: value.repair_hint ?? null }));
  return {
    overall,
    score: score ?? null,
    animations: Object.fromEntries(Object.entries(animations).map(([name, animation]) => [name, {
      score: animation.score,
      hints: animation.hints.slice(0, SUMMARY_HINTS_PER_ANIMATION),
      more_hints: Math.max(0, animation.hints.length - SUMMARY_HINTS_PER_ANIMATION),
    }])),
    failing_frames: failing.slice(0, SUMMARY_FAILING_FRAMES),
    failing_frame_count: failing.length,
    visual_review: "Not performed. The score covers deterministic checks only; packing still needs visual_qa.status 'pass'.",
  };
}

export async function readQaReport(root: string, asset: string): Promise<unknown> {
  await loadRequest(root, asset);
  try {
    const reportPath = path.join(assetDirectory(root, asset), "qa-report.json");
    if (!await isFile(reportPath)) throw new Error("missing");
    return JSON.parse(await readFile(reportPath, "utf8"));
  } catch {
    throw new Error(`Asset '${asset}' has no valid qa-report.json. Run deterministic QA first.`);
  }
}
