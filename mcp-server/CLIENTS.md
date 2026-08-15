# Client setup

Build once from `aiplaybook/mcp-server`:

```bash
npm install
npm run check
```

Replace `/absolute/path/to/aiplaybook` in the examples below. The local editor can generate the exact configuration automatically from its **AI Agent Handoff** card.

## Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.aiplaybook]
command = "node"
args = ["/absolute/path/to/aiplaybook/mcp-server/dist/index.js"]

[mcp_servers.aiplaybook.env]
AIPLAYBOOK_ROOT = "/absolute/path/to/aiplaybook"
```

## Claude Code or Claude Desktop

Project `.mcp.json`:

```json
{
  "mcpServers": {
    "aiplaybook": {
      "command": "node",
      "args": ["/absolute/path/to/aiplaybook/mcp-server/dist/index.js"],
      "env": { "AIPLAYBOOK_ROOT": "/absolute/path/to/aiplaybook" }
    }
  }
}
```

Claude Code can also register the same stdio command with `claude mcp add`.

## Gemini CLI

Add the same `mcpServers.aiplaybook` JSON object to `.gemini/settings.json`, then run `/mcp list` inside Gemini CLI to verify that the seven aiplaybook tools are ready.

## Antigravity and other image agents

If the host supports local stdio MCP, use the same JSON configuration. Otherwise use the editor's **Copy active frame task** button, generate the PNG with the supplied references, then let a connected Codex, Claude, or Gemini client call `aiplaybook_submit_generated_frame`. This fallback preserves the same filenames and QA gate without assuming an Antigravity-specific plugin API.

## Trust boundary

- The hosted Playground has no write endpoint.
- Existing generated references and frames are explicitly treated as failed and unapproved; repair starts from `input.png` when available.
- Local submission accepts only declared frame names, valid PNG, exact `frame_size`, and at most 20 MiB.
- Replacing an existing frame is explicit and surfaced as destructive by MCP annotations.
- Deterministic QA cannot approve packing; visual QA remains separate.
