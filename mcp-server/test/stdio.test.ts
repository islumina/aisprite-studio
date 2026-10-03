import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "aisprite-studio-mcp-stdio-"));
  const asset = path.join(root, "assets", "orb");
  await mkdir(path.join(asset, "frames"), { recursive: true });
  await writeFile(path.join(asset, "request.yml"), [
    "character: orb",
    "style: flat game icon",
    "frame_size: 32",
    "asset_type: effect",
    "animations:",
    "  - action: glow",
    "    direction: front",
    "    frames: 1",
  ].join("\n"));
  const reference = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(reference);
  reference.writeUInt32BE(32, 16);
  reference.writeUInt32BE(32, 20);
  await writeFile(path.join(asset, "tpose.png"), reference);
  return root;
}

test("stdio server exposes the generation workflow", async () => {
  const root = await createWorkspace();
  const client = new Client({ name: "aisprite-studio-test-client", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/index.js")],
    env: { ...process.env, AISPRITE_STUDIO_ROOT: root },
  });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [
      "aisprite_studio_get_generation_task",
      "aisprite_studio_get_qa_report",
      "aisprite_studio_get_reference_task",
      "aisprite_studio_get_row_task",
      "aisprite_studio_list_assets",
      "aisprite_studio_run_deterministic_qa",
      "aisprite_studio_submit_generated_frame",
      "aisprite_studio_submit_generated_row",
      "aisprite_studio_submit_reference",
      ],
    );
    const result = await client.callTool({
      name: "aisprite_studio_list_assets",
      arguments: { limit: 10, offset: 0 },
    });
    assert.equal(result.isError, undefined);
    const structured = result.structuredContent as { total?: unknown } | undefined;
    assert.equal(structured?.total, 1);
  } finally {
    await client.close();
  }
});

test("accepts the legacy project-root environment variable", async () => {
  const root = await createWorkspace();
  const legacyEnvironment = { ...process.env };
  delete legacyEnvironment.AISPRITE_STUDIO_ROOT;
  const client = new Client({ name: "aisprite-studio-legacy-env-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/index.js")],
    env: { ...legacyEnvironment, AIPLAYBOOK_ROOT: root },
  });
  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "aisprite_studio_list_assets",
      arguments: { limit: 10, offset: 0 },
    });
    const structured = result.structuredContent as { total?: unknown } | undefined;
    assert.equal(structured?.total, 1);
  } finally {
    await client.close();
  }
});
