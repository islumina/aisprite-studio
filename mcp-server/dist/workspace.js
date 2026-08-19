import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import * as z from "zod/v4";
const ASSET_ID = /^[A-Za-z0-9_-]{1,80}$/;
const FRAME_ID = /^[A-Za-z0-9_-]{1,160}$/;
const MAX_PNG_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const AnimationSchema = z.object({
    action: z.string().regex(ASSET_ID),
    direction: z.string().regex(ASSET_ID),
    frames: z.number().int().min(1).max(240).default(4),
}).strict();
const RequestSchema = z.object({
    character: z.string().regex(ASSET_ID).optional(),
    style: z.string().min(1).max(500).default("3d cartoon game style"),
    frame_size: z.number().int().min(16).max(4096).default(512),
    asset_type: z.enum(["character", "object", "effect"]).default("character"),
    animations: z.array(AnimationSchema).min(1).max(100),
}).passthrough();
function safeId(value, label, pattern = ASSET_ID) {
    if (!pattern.test(value))
        throw new Error(`${label} must contain only letters, numbers, underscore, or hyphen.`);
    return value;
}
async function isFile(filePath) {
    try {
        return (await lstat(filePath)).isFile();
    }
    catch {
        return false;
    }
}
async function isDirectory(directoryPath) {
    try {
        return (await lstat(directoryPath)).isDirectory();
    }
    catch {
        return false;
    }
}
async function ensureDirectory(directoryPath) {
    try {
        if (!(await lstat(directoryPath)).isDirectory())
            throw new Error(`${directoryPath} must be a real directory, not a symlink.`);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
        await mkdir(directoryPath, { recursive: true });
    }
}
async function assertDirectoryIfPresent(directoryPath, label) {
    try {
        if (!(await lstat(directoryPath)).isDirectory())
            throw new Error(`${label} must be a real directory, not a symlink.`);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
}
export function assetDirectory(root, asset) {
    return path.join(root, "assets", safeId(asset, "asset"));
}
export async function loadRequest(root, asset) {
    const directory = assetDirectory(root, asset);
    if (!await isDirectory(directory))
        throw new Error(`Asset '${asset}' must be a real directory, not a symlink.`);
    const requestPath = path.join(directory, "request.yml");
    let source;
    try {
        const info = await lstat(requestPath);
        if (!info.isFile() || info.size > 256 * 1024)
            throw new Error("request.yml must be a regular file no larger than 256 KiB.");
        source = await readFile(requestPath, "utf8");
    }
    catch {
        throw new Error(`Asset '${asset}' has no readable request.yml.`);
    }
    return RequestSchema.parse(parse(source));
}
export function frameSpecs(request) {
    return request.animations.flatMap((animation) => Array.from({ length: animation.frames }, (_, index) => ({
        name: `${animation.action}_${animation.direction}_${String(index).padStart(2, "0")}`,
        action: animation.action,
        direction: animation.direction,
        index,
        total: animation.frames,
    })));
}
async function qaStatus(assetDir) {
    try {
        const reportPath = path.join(assetDir, "qa-report.json");
        if (!await isFile(reportPath))
            return "missing";
        const value = JSON.parse(await readFile(reportPath, "utf8"));
        if (value && typeof value === "object" && "overall" in value && typeof value.overall === "string") {
            return value.overall;
        }
        return "invalid";
    }
    catch {
        return "missing";
    }
}
export async function listAssets(root) {
    const entries = await readdir(path.join(root, "assets"), { withFileTypes: true });
    const assets = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || !ASSET_ID.test(entry.name))
            continue;
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
        }
        catch {
            // Directories without a valid request are not generation workspaces.
        }
    }
    return assets;
}
function buildPrompt(asset, request, frame) {
    const categoryRule = {
        character: "Preserve the same face, outfit, colours, and proportions. Animate the pose; do not return a T-pose.",
        object: "Keep the object's main body pixel-aligned with the reference; change only dynamic parts.",
        effect: "Keep the palette, style, centre, and bounding box consistent while particle details may vary.",
    }[request.asset_type];
    const continuity = frame.index === 0
        ? "Establish scale, framing, and palette from the canonical reference."
        : `Continue motion from ${frame.action}_${frame.direction}_${String(frame.index - 1).padStart(2, "0")}.png without changing identity or scale.`;
    return [
        `Generate ${frame.name}.png, frame ${frame.index + 1} of ${frame.total} for the '${frame.action}' animation facing '${frame.direction}'.`,
        `Subject: ${asset}. Asset type: ${request.asset_type}. Style: ${request.style}.`,
        categoryRule,
        "Use only visually approved references as identity truth. Existing bundled generated images are known failed artifacts until separately approved; do not preserve visible defects.",
        continuity,
        `Output exactly ${request.frame_size}x${request.frame_size} PNG. Use a solid green screen (#00FF00), or solid blue (#0000FF) only when the subject is mostly green.`,
        "Use flat even lighting, absolutely no shadows or ground plane, and no green/blue colour spill on the subject. Centre the subject with about 10% padding. Output only the image.",
    ].join("\n");
}
export async function getReferenceTask(root, asset) {
    const request = await loadRequest(root, asset);
    const dir = assetDirectory(root, asset);
    const candidates = [path.join(dir, "input.png"), path.join(dir, "tpose.png")];
    const references = [];
    for (const candidate of candidates) {
        if (await isFile(candidate))
            references.push(candidate);
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
            `Output exactly ${request.frame_size}x${request.frame_size} PNG on a solid green screen (#00FF00), or solid blue (#0000FF) only when the subject is mostly green.`,
            "Use flat even lighting, absolutely no body or ground-plane shadows, no scenery, no detached effects, and no green/blue colour spill. Centre the subject with about 10% padding. Output only the image.",
        ].join("\n"),
    };
}
export async function getGenerationTask(root, asset, requestedFrame) {
    const request = await loadRequest(root, asset);
    const specs = frameSpecs(request);
    let frame;
    if (requestedFrame) {
        safeId(requestedFrame, "frame", FRAME_ID);
        frame = specs.find((candidate) => candidate.name === requestedFrame);
        if (!frame)
            throw new Error(`Frame '${requestedFrame}' is not declared in ${asset}/request.yml.`);
    }
    else {
        for (const candidate of specs) {
            if (!await isFile(path.join(assetDirectory(root, asset), "frames", `${candidate.name}.png`))) {
                frame = candidate;
                break;
            }
        }
    }
    if (!frame)
        throw new Error(`Asset '${asset}' has no missing frames. Specify a declared frame to repair it.`);
    const dir = assetDirectory(root, asset);
    const framesDir = path.join(dir, "frames");
    await assertDirectoryIfPresent(framesDir, `Asset '${asset}' frames path`);
    const candidates = [
        path.join(dir, "tpose.png"),
        path.join(dir, "input.png"),
        frame.index > 0 ? path.join(dir, "frames", `${frame.action}_${frame.direction}_00.png`) : "",
        frame.index > 0 ? path.join(dir, "frames", `${frame.action}_${frame.direction}_${String(frame.index - 1).padStart(2, "0")}.png`) : "",
    ].filter(Boolean);
    const references = [];
    for (const candidate of candidates) {
        if (references.length === 3)
            break;
        if (await isFile(candidate) && !references.includes(candidate))
            references.push(candidate);
    }
    if (references.length === 0) {
        throw new Error(`Asset '${asset}' has no usable tpose.png, input.png, or continuity frame.`);
    }
    return { asset, frame, request, prompt: buildPrompt(asset, request, frame), reference_paths: references };
}
export function parsePng(buffer) {
    if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error("Submitted data is not a valid PNG file.");
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width < 1 || height < 1)
        throw new Error("PNG dimensions are invalid.");
    return { width, height };
}
export async function submitFrame(root, asset, frameName, encoded, replace) {
    const request = await loadRequest(root, asset);
    safeId(frameName, "frame", FRAME_ID);
    if (!frameSpecs(request).some((frame) => frame.name === frameName)) {
        throw new Error(`Frame '${frameName}' is not declared in ${asset}/request.yml.`);
    }
    const target = path.join(assetDirectory(root, asset), "frames", `${frameName}.png`);
    return savePng(root, target, encoded, request.frame_size, replace, `Frame '${frameName}'`);
}
async function savePng(root, target, encoded, frameSize, replace, label) {
    const payload = encoded.replace(/^data:image\/png;base64,/, "");
    if (payload.length > Math.ceil(MAX_PNG_BYTES * 4 / 3) + 8)
        throw new Error("PNG exceeds the 20 MiB limit.");
    if (payload.length === 0 || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
        throw new Error("PNG payload must be canonical base64 data.");
    }
    const buffer = Buffer.from(payload, "base64");
    if (buffer.length > MAX_PNG_BYTES)
        throw new Error("PNG exceeds the 20 MiB limit.");
    const dimensions = parsePng(buffer);
    if (dimensions.width !== frameSize || dimensions.height !== frameSize) {
        throw new Error(`PNG must be ${frameSize}x${frameSize}; received ${dimensions.width}x${dimensions.height}.`);
    }
    await ensureDirectory(path.dirname(target));
    if (!replace) {
        try {
            await writeFile(target, buffer, { flag: "wx" });
        }
        catch (error) {
            if (error.code === "EEXIST") {
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
export async function submitReference(root, asset, encoded, replace) {
    const request = await loadRequest(root, asset);
    const target = path.join(assetDirectory(root, asset), "tpose.png");
    return savePng(root, target, encoded, request.frame_size, replace, `Reference '${asset}/tpose.png'`);
}
export async function runDeterministicQa(root, asset) {
    await loadRequest(root, asset);
    await assertDirectoryIfPresent(path.join(assetDirectory(root, asset), "frames"), `Asset '${asset}' frames path`);
    const args = ["-m", "tools.sprite_pipeline.cli", "qa", path.join("assets", asset), "--skip-vision"];
    return await new Promise((resolve, reject) => {
        const child = spawn("python3", args, {
            cwd: root,
            env: { ...process.env, PYTHONPYCACHEPREFIX: "/private/tmp/aiplaybook-mcp-pycache" },
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
        });
        const chunks = [];
        let capturedBytes = 0;
        const capture = (chunk) => {
            if (capturedBytes >= 25_000)
                return;
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
export async function readQaReport(root, asset) {
    await loadRequest(root, asset);
    try {
        const reportPath = path.join(assetDirectory(root, asset), "qa-report.json");
        if (!await isFile(reportPath))
            throw new Error("missing");
        return JSON.parse(await readFile(reportPath, "utf8"));
    }
    catch {
        throw new Error(`Asset '${asset}' has no valid qa-report.json. Run deterministic QA first.`);
    }
}
//# sourceMappingURL=workspace.js.map