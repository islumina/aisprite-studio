import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "yaml";
import * as z from "zod/v4";

const ASSET_ID = /^[A-Za-z0-9_-]{1,80}$/;
const FRAME_ID = /^[A-Za-z0-9_-]{1,160}$/;
const MAX_PNG_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const AnimationSchema = z.object({
  action: z.string().regex(ASSET_ID),
  // Empty for subjects without a facing (fish, effects): frames are then `swim_00`.
  direction: z.string().regex(/^[A-Za-z0-9_-]{0,80}$/).default(""),
  frames: z.number().int().min(1).max(240).default(4),
  fps: z.number().int().min(1).max(60).optional(),
}).strict();

const RequestSchema = z.object({
  character: z.string().regex(ASSET_ID).optional(),
  style: z.string().min(1).max(500).default("3d cartoon game style"),
  frame_size: z.number().int().min(16).max(4096).default(512),
  asset_type: z.enum(["character", "object", "effect"]).default("character"),
  animations: z.array(AnimationSchema).min(1).max(100),
}).passthrough();

export type AssetRequest = z.infer<typeof RequestSchema>;

export interface FrameSpec {
  name: string;
  animation: string;
  action: string;
  direction: string;
  index: number;
  total: number;
}

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

export interface RowLayout {
  frames: number;
  columns: number;
  rows: number;
  slot: number;
  canvas: [number, number];
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

// Frame names must match tools/sprite_pipeline/spec.py; tests/spec-parity.test.mjs checks both.
export function animationName(action: string, direction: string): string {
  return direction ? `${action}_${direction}` : action;
}

export function frameName(action: string, direction: string, index: number): string {
  return `${animationName(action, direction)}_${String(index).padStart(2, "0")}`;
}

export function frameSpecs(request: AssetRequest): FrameSpec[] {
  return request.animations.flatMap((animation) => Array.from(
    { length: animation.frames },
    (_, index) => ({
      name: frameName(animation.action, animation.direction, index),
      animation: animationName(animation.action, animation.direction),
      action: animation.action,
      direction: animation.direction,
      index,
      total: animation.frames,
    }),
  ));
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

// Pose outline per action, indexed by frame and wrapping when an animation has more frames.
const POSES: Readonly<Record<string, readonly string[]>> = {
  idle: [
    "neutral resting pose, arms relaxed at sides, clothes begin to flutter very slightly",
    "slight inhale, chest rises slightly, cloth drifts leftward",
    "breathing in, cloth ripples slightly more",
    "peak of breath, a touch taller",
    "beginning to exhale, cloth drifting back toward centre",
    "mid-exhale, cloth settling",
    "exhaling further, chest lowering",
    "returning to neutral, bridging back into frame 0 without duplicating it",
  ],
  walk: ["contact: lead foot forward, opposite arm forward", "passing: legs crossing, body low", "opposite contact: other foot forward", "passing: legs crossing", "high point of the stride", "recovery: bridging back into frame 0 without duplicating it"],
  run: ["contact: lead foot strikes the ground, body leans forward", "drive: push off, back leg extends", "float: both feet briefly off the ground", "contact: opposite foot strikes", "drive: opposite push-off", "recovery: bridging back into frame 0 without duplicating it"],
  attack: ["wind-up: lean back, weapon raised", "strike: lunge forward, weapon swung (strongest pose)", "follow-through: weapon low, body still forward", "recovery: settle toward the idle pose"],
  cast: ["hands rising, energy gathering", "arms extended, magic circle visible at its peak", "release: burst of energy outward", "arms lowering, residual glow fading"],
  jump: ["crouch: knees bent, preparing to spring", "ascend: body rising, arms up", "apex: highest point, brief float", "descend: falling, arms adjusting", "land: impact, knees absorbing"],
  hurt: ["initial recoil: body jerks back, pain expression", "maximum stagger: leaning away", "recovery: returning toward upright"],
  die: ["first hit: flinching, eyes closed", "buckling: knees giving way", "falling: body tilting", "on the ground: collapsed, motionless"],
  open: ["closed: fully shut", "crack: first gap appears, a hint of the contents", "half-open: lid or door at its midpoint", "wide open: contents revealed", "settle: slight bounce back from open", "final rest: fully open and still"],
  close: ["open: starting fully open", "beginning to close", "half-closed: midpoint", "nearly shut: small gap remaining", "fully closed"],
  shine: ["sparkles at positions A: scattered glints", "sparkles at positions B: shifted glints, brighter core", "sparkles at positions C: peak brightness", "sparkles at positions D: dimming, bridging back into frame 0 without duplicating it"],
  activate: ["mechanism at rest", "trigger: initial movement begins", "mid-action: mechanism in motion", "engaged: mechanism reaches its final position"],
  burn: ["flame tongues leaning left, bright core", "flame tongues leaning right, wider spread", "tall narrow flame, intense core", "broad low flame, embers rising", "medium flame, sparks scattering", "returning toward the frame 0 shape without duplicating it"],
  explode: ["origin: tiny bright core", "first expansion: ring of debris outward", "peak: maximum radius, bright flash", "dissipating: fading edges, smoke wisps", "remnants: scattered particles, dim glow"],
  magic: ["rune circle at rest: base pattern visible", "rotated 90 degrees, glow intensifying", "rotated 180 degrees, peak brightness", "rotated 270 degrees, glow fading", "returning to the base orientation without duplicating frame 0"],
  heal: ["first particles rising from below", "more particles, glow spreading upward", "peak: dense particle cloud, brightest glow", "particles fading, glow dimming, bridging back into frame 0"],
  hit: ["impact flash: bright star at the centre", "spark burst: lines radiating outward", "dissipating: sparks fading, lines shortening"],
};

const FACING: Readonly<Record<string, string>> = {
  front: "facing the viewer (front view)",
  back: "seen from behind (back view)",
  left: "in side profile facing left",
  right: "in side profile facing right",
};

const FRAME_RULES = {
  character: "Preserve the same face, outfit, colours, and proportions. Animate the pose; do not return a T-pose.",
  object: "Keep the object's main body pixel-aligned with the reference; change only dynamic parts.",
  effect: "Keep the palette, style, centre, and bounding box consistent while particle details may vary.",
} as const;

const BACKGROUND_RULE = "Use one flat, solid green screen (#00FF00), or solid blue (#0000FF) only when the subject is mostly green.";
const LIGHTING_RULE = "Use flat even lighting, absolutely no shadows or ground plane, no scenery, no detached effects, and no green/blue colour spill on the subject. Centre the subject with about 10% padding. Output only the image.";

export function poseFor(frame: FrameSpec): string {
  const cycle = POSES[frame.action.toLowerCase()];
  const pose = cycle ? cycle[frame.index % cycle.length] : undefined;
  return pose ?? `phase ${frame.index + 1} of ${frame.total} of the '${frame.action}' motion`;
}

function framePrompt(asset: string, request: AssetRequest, frame: FrameSpec): string {
  const facing = FACING[frame.direction] ?? (frame.direction ? `facing '${frame.direction}'` : "");
  const continuity = frame.index === 0
    ? "Establish scale, framing, and palette from the canonical reference."
    : `Continue motion from ${frameName(frame.action, frame.direction, frame.index - 1)}.png without changing identity or scale.`;
  return [
    `Generate ${frame.name}.png, frame ${frame.index + 1} of ${frame.total} of the '${frame.action}' animation${facing ? `, ${facing}` : ""}.`,
    `Subject: ${asset}. Asset type: ${request.asset_type}. Style: ${request.style}.`,
    FRAME_RULES[request.asset_type],
    `Pose: ${poseFor(frame)}.`,
    "Treat references as identity guidance only and do not copy their visible defects.",
    continuity,
    `Output exactly ${request.frame_size}x${request.frame_size} PNG. ${BACKGROUND_RULE}`,
    LIGHTING_RULE,
  ].join("\n");
}

export async function getReferenceTask(root: string, asset: string): Promise<ReferenceTask> {
  const request = await loadRequest(root, asset);
  const dir = assetDirectory(root, asset);
  const candidates = [path.join(dir, "input.png"), path.join(dir, "tpose.png")];
  const references: string[] = [];
  for (const candidate of candidates) {
    if (await isFile(candidate)) references.push(candidate);
  }
  const categoryRule = {
    character: "Create one neutral full-body front reference pose with stable face, outfit, colours, proportions, and a readable silhouette.",
    object: "Create the canonical static base state, such as closed or off, with all reusable body geometry clearly visible.",
    effect: "Create one representative canonical effect frame with a stable palette, centre, scale, and bounding box.",
  }[request.asset_type];
  const status = await qaStatus(dir);
  const warning = "Existing generated images are unapproved failure artifacts. Prefer input.png for identity; use tpose.png only as repair context and do not preserve its defects.";
  return {
    asset,
    request,
    known_asset_status: status,
    reference_warning: warning,
    reference_paths: references,
    prompt: [
      `Generate a replacement tpose.png for '${asset}'. Asset type: ${request.asset_type}. Style: ${request.style}.`,
      categoryRule,
      warning,
      `Output exactly ${request.frame_size}x${request.frame_size} PNG. ${BACKGROUND_RULE}`,
      LIGHTING_RULE,
    ].join("\n"),
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
  const first = frames[0];
  if (!first) throw new Error(`Animation '${animation}' is not declared in ${asset}/request.yml.`);
  const outline = frames.map((frame) => ({ name: frame.name, pose: poseFor(frame) }));
  const facing = FACING[first.direction] ?? (first.direction ? `facing '${first.direction}'` : "");
  return {
    asset,
    animation,
    frames: outline,
    prompt: [
      `Animation '${animation}' of ${asset}: ${frames.length} frames${facing ? `, ${facing}` : ""}. Asset type: ${request.asset_type}. Style: ${request.style}.`,
      FRAME_RULES[request.asset_type],
      "Generate each frame as its own PNG with the exact name below; frame 0 sets scale, framing, and palette.",
      ...outline.map((frame) => `  ${frame.name}: ${frame.pose}`),
      `Output exactly ${request.frame_size}x${request.frame_size} PNG per frame. ${BACKGROUND_RULE}`,
      LIGHTING_RULE,
    ].join("\n"),
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

function rowPrompt(asset: string, request: AssetRequest, frames: FrameSpec[], layout: RowLayout): string {
  const first = frames[0]!;
  const facing = FACING[first.direction] ?? (first.direction ? `facing '${first.direction}'` : "");
  const order = layout.rows > 1 ? "left to right, then top to bottom" : "left to right";
  const floor = request.asset_type === "effect" ? "centred in" : "standing on the floor line of";
  return [
    `Draw all ${frames.length} frames of the '${first.action}' animation of ${asset}${facing ? `, ${facing}` : ""}, in ONE ${layout.canvas[0]}x${layout.canvas[1]} image: ${layout.columns} per row, ${layout.rows} row(s), in reading order (${order}).`,
    `Subject: ${asset}. Asset type: ${request.asset_type}. Style: ${request.style}.`,
    FRAME_RULES[request.asset_type],
    `The attached layout guide shows the numbered boxes. Draw pose k inside box k, within its inner safe area and ${floor} its box. Do not draw the boxes, lines, or numbers.`,
    "Every pose shows the same subject at the same scale; only the pose changes. Keep clear background between neighbouring poses: no pose may touch another pose or the image edge.",
    "Treat references as identity guidance only and do not copy their visible defects.",
    "Poses:",
    ...frames.map((frame, index) => `  ${index + 1}. ${frame.name}: ${poseFor(frame)}`),
    BACKGROUND_RULE.replace("Use one flat, solid", "Fill the whole image with one flat, solid"),
    LIGHTING_RULE,
  ].join("\n");
}

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

export async function runDeterministicQa(root: string, asset: string): Promise<{ exit_code: number; output: string }> {
  await loadRequest(root, asset);
  await assertDirectoryIfPresent(path.join(assetDirectory(root, asset), "frames"), `Asset '${asset}' frames path`);
  const args = ["-m", "tools.sprite_pipeline.cli", "qa", path.join("assets", asset), "--skip-vision"];
  return await new Promise((resolve, reject) => {
    const child = spawn("python3", args, {
      cwd: root,
      env: { ...process.env, PYTHONPYCACHEPREFIX: path.join(tmpdir(), "aisprite-studio-mcp-pycache") },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let capturedBytes = 0;
    const capture = (chunk: Buffer) => {
      if (capturedBytes >= 25_000) return;
      const remaining = 25_000 - capturedBytes;
      const bounded = chunk.subarray(0, remaining);
      chunks.push(bounded);
      capturedBytes += bounded.length;
    };
    const timer = setTimeout(() => child.kill("SIGTERM"), 60_000);
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ exit_code: code ?? 1, output: Buffer.concat(chunks).toString("utf8") });
    });
  });
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
