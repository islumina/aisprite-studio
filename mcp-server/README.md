# aiplaybook MCP server

Local stdio bridge that lets MCP-capable AI clients inspect sprite workspaces, repair the canonical reference, receive exact frame prompts plus PNG references, submit generated images, and run deterministic QA.

The server never calls an image API and stores no API key. Image generation remains a capability of the connected AI host. Submitted files are constrained to declared `assets/{asset}/frames/{frame}.png` paths, validated as PNG, limited to 20 MiB, and required to match `frame_size`.

## Setup

```bash
cd mcp-server
npm install
npm run check
```

Example client configuration:

```json
{
  "mcpServers": {
    "aiplaybook": {
      "command": "node",
      "args": ["/absolute/path/to/aiplaybook/mcp-server/dist/index.js"],
      "env": {
        "AIPLAYBOOK_ROOT": "/absolute/path/to/aiplaybook"
      }
    }
  }
}
```

See [CLIENTS.md](./CLIENTS.md) for Codex, Claude, Gemini CLI, and Antigravity/manual handoff examples.

## Agent workflow

1. `aiplaybook_list_assets`
2. If the reference is failed: `aiplaybook_get_reference_task`, generate one replacement, then `aiplaybook_submit_reference`.
3. After visual reference approval: `aiplaybook_get_generation_task`.
4. Generate one frame PNG with all returned image references.
5. `aiplaybook_submit_generated_frame`
6. `aiplaybook_run_deterministic_qa`
7. `aiplaybook_get_qa_report`

All bundled generated images are treated as failed, unapproved artifacts. Submitting a replacement does not approve it. Deterministic QA is not visual approval, and the existing pack gate still requires an explicit visual QA pass.
