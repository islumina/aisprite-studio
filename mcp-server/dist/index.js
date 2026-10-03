#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { getGenerationTask, getReferenceTask, listAssets, readQaReport, runDeterministicQa, submitFrame, submitReference, } from "./workspace.js";
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROOT = path.resolve(process.env.AISPRITE_STUDIO_ROOT ?? process.env.AIPLAYBOOK_ROOT ?? DEFAULT_ROOT);
const AssetId = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
const FrameId = z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/);
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
async function imageContent(referencePath) {
    const data = await readFile(referencePath);
    if (data.length > MAX_REFERENCE_BYTES)
        throw new Error(`Reference '${path.basename(referencePath)}' exceeds 20 MiB.`);
    return { type: "image", data: data.toString("base64"), mimeType: "image/png" };
}
function success(value, summary) {
    return {
        content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(value, null, 2)}` }],
        structuredContent: value,
    };
}
function failure(error) {
    return {
        isError: true,
        content: [{
                type: "text",
                text: `AI Sprite Studio error: ${error instanceof Error ? error.message : "Unexpected failure"}`,
            }],
    };
}
export function createServer() {
    const server = new McpServer({ name: "aisprite-studio-mcp-server", version: "0.1.0" }, {
        instructions: "Use aisprite_studio_list_assets first. Existing bundled generated images are failed, unapproved artifacts. Repair the canonical reference with aisprite_studio_get_reference_task when needed, then generate only the exact frame returned by aisprite_studio_get_generation_task using every returned reference. Submit the PNG and run deterministic QA. Deterministic QA is not visual approval and never authorises packing.",
    });
    server.registerTool("aisprite_studio_list_assets", {
        title: "List Sprite Generation Assets",
        description: "List generation workspaces, frame progress, references, and QA status. Read-only. Existing bundled images may be failed fixtures.",
        inputSchema: z.object({
            limit: z.number().int().min(1).max(50).default(20),
            offset: z.number().int().min(0).default(0),
        }).strict(),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ limit, offset }) => {
        try {
            const all = await listAssets(ROOT);
            const items = all.slice(offset, offset + limit);
            return success({
                total: all.length,
                count: items.length,
                offset,
                items,
                has_more: offset + items.length < all.length,
                next_offset: offset + items.length < all.length ? offset + items.length : null,
            }, `Found ${all.length} generation assets.`);
        }
        catch (error) {
            return failure(error);
        }
    });
    server.registerTool("aisprite_studio_get_reference_task", {
        title: "Get Reference Image Repair Task",
        description: "Return the exact tpose/base-reference repair prompt and available PNG context. Existing generated images are explicitly marked as failed and unapproved.",
        inputSchema: z.object({ asset: AssetId }).strict(),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ asset }) => {
        try {
            const task = await getReferenceTask(ROOT, asset);
            const images = await Promise.all(task.reference_paths.map(imageContent));
            const structured = {
                ...task,
                reference_paths: task.reference_paths.map((referencePath) => path.relative(ROOT, referencePath)),
            };
            return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }, ...images], structuredContent: structured };
        }
        catch (error) {
            return failure(error);
        }
    });
    server.registerTool("aisprite_studio_submit_reference", {
        title: "Submit a Repaired Reference PNG",
        description: "Validate and atomically save one replacement tpose.png. Replacing the known failed artifact must be explicit.",
        inputSchema: z.object({
            asset: AssetId,
            png_base64: z.string().min(16).max(28_000_000),
            replace: z.boolean().default(false),
        }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    }, async ({ asset, png_base64, replace }) => {
        try {
            const result = await submitReference(ROOT, asset, png_base64, replace);
            return success(result, `Saved ${result.path}. Treat it as pending until visual review approves it.`);
        }
        catch (error) {
            return failure(error);
        }
    });
    server.registerTool("aisprite_studio_get_generation_task", {
        title: "Get One Image Generation Task",
        description: "Return one exact frame prompt plus up to three PNG reference images. Omit frame to select the first missing frame; specify a declared frame for repair.",
        inputSchema: z.object({
            asset: AssetId.describe("Asset directory name, for example reimu or chest"),
            frame: FrameId.optional().describe("Declared frame stem without .png, for example walk_front_02"),
        }).strict(),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ asset, frame }) => {
        try {
            const task = await getGenerationTask(ROOT, asset, frame);
            const images = await Promise.all(task.reference_paths.map(imageContent));
            const structured = {
                asset: task.asset,
                frame: task.frame,
                request: task.request,
                prompt: task.prompt,
                reference_files: task.reference_paths.map((referencePath) => path.relative(ROOT, referencePath)),
            };
            return {
                content: [{ type: "text", text: JSON.stringify(structured, null, 2) }, ...images],
                structuredContent: structured,
            };
        }
        catch (error) {
            return failure(error);
        }
    });
    server.registerTool("aisprite_studio_submit_generated_frame", {
        title: "Submit a Generated PNG Frame",
        description: "Validate and atomically save one base64 PNG into the declared asset frames directory. Set replace only when intentionally repairing an existing failed frame.",
        inputSchema: z.object({
            asset: AssetId,
            frame: FrameId.describe("Declared frame stem without .png"),
            png_base64: z.string().min(16).max(28_000_000).describe("Raw base64 or a data:image/png;base64 URL, maximum decoded size 20 MiB"),
            replace: z.boolean().default(false),
        }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    }, async ({ asset, frame, png_base64, replace }) => {
        try {
            const result = await submitFrame(ROOT, asset, frame, png_base64, replace);
            return success(result, `Saved ${result.path}. Run aisprite_studio_run_deterministic_qa next.`);
        }
        catch (error) {
            return failure(error);
        }
    });
    server.registerTool("aisprite_studio_run_deterministic_qa", {
        title: "Run Deterministic Sprite QA",
        description: "Run local file, dimension, chroma-key, coverage, and drift checks for an asset. This updates qa-report.json but does not perform or claim visual approval.",
        inputSchema: z.object({ asset: AssetId }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ asset }) => {
        try {
            const result = await runDeterministicQa(ROOT, asset);
            if (result.exit_code !== 0)
                return failure(new Error(`QA exited ${result.exit_code}: ${result.output}`));
            return success(result, "Deterministic QA completed. Visual review is still required before packing.");
        }
        catch (error) {
            return failure(error);
        }
    });
    server.registerTool("aisprite_studio_get_qa_report", {
        title: "Read Sprite QA Report",
        description: "Read the current qa-report.json for an asset. Read-only; warn/pending/fail results require repair or visual review.",
        inputSchema: z.object({ asset: AssetId }).strict(),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ asset }) => {
        try {
            const report = await readQaReport(ROOT, asset);
            return success({ report }, `QA report for ${asset}.`);
        }
        catch (error) {
            return failure(error);
        }
    });
    return server;
}
if (process.argv.includes("--help")) {
    process.stdout.write("Usage: node dist/index.js\nEnvironment: AISPRITE_STUDIO_ROOT=/absolute/path/to/aisprite-studio\nTransport: stdio\n");
}
else {
    void serveStdio(createServer);
    console.error(`AI Sprite Studio MCP server ready for ${ROOT}`);
}
//# sourceMappingURL=index.js.map