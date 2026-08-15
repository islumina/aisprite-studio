import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("stdio server exposes the generation workflow", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aiplaybook-mcp-stdio-"));
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

  const client = new Client({ name: "aiplaybook-test-client", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/index.js")],
    env: { ...process.env, AIPLAYBOOK_ROOT: root },
  });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [
      "aiplaybook_get_generation_task",
      "aiplaybook_get_qa_report",
      "aiplaybook_get_reference_task",
      "aiplaybook_list_assets",
      "aiplaybook_run_deterministic_qa",
      "aiplaybook_submit_generated_frame",
      "aiplaybook_submit_reference",
      ],
    );
    const result = await client.callTool({
      name: "aiplaybook_list_assets",
      arguments: { limit: 10, offset: 0 },
    });
    assert.equal(result.isError, undefined);
    const structured = result.structuredContent as { total?: unknown } | undefined;
    assert.equal(structured?.total, 1);
  } finally {
    await client.close();
  }
});
