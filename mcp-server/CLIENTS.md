# Client setup

Build once from the `aisprite-studio` repository root:

```bash
npm ci
npm run test:mcp
```

Replace `/absolute/path/to/aisprite-studio` in the examples below. The local editor can generate the exact configuration automatically from its **AI Agent Handoff** card. `AIPLAYBOOK_ROOT` remains a temporary fallback for existing local configurations, but new setups should use `AISPRITE_STUDIO_ROOT`.

## Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.aisprite-studio]
command = "node"
args = ["/absolute/path/to/aisprite-studio/mcp-server/dist/index.js"]

[mcp_servers.aisprite-studio.env]
AISPRITE_STUDIO_ROOT = "/absolute/path/to/aisprite-studio"
```

## Claude Code or Claude Desktop

Claude Code reads a project `.mcp.json`; Claude Desktop reads `claude_desktop_config.json`. Both use the same `mcpServers` object:

```json
{
  "mcpServers": {
    "aisprite-studio": {
      "command": "node",
      "args": ["/absolute/path/to/aisprite-studio/mcp-server/dist/index.js"],
      "env": { "AISPRITE_STUDIO_ROOT": "/absolute/path/to/aisprite-studio" }
    }
  }
}
```

Claude Code can also register the same stdio command from the command line:

```bash
claude mcp add aisprite-studio -e AISPRITE_STUDIO_ROOT=/absolute/path/to/aisprite-studio -- node /absolute/path/to/aisprite-studio/mcp-server/dist/index.js
```

## Gemini CLI

Add the same `mcpServers["aisprite-studio"]` JSON object to `.gemini/settings.json`, then run `/mcp list` inside Gemini CLI to verify that the seven AI Sprite Studio tools are ready.

## Antigravity and other image agents

If the host supports local stdio MCP, use the same JSON configuration. Otherwise use the editor's **Copy active frame task** button, generate the PNG with the supplied references, then let a connected Codex, Claude, or Gemini client call `aisprite_studio_submit_generated_frame`. This fallback preserves the same filenames and QA gate without assuming an Antigravity-specific plugin API.

## Trust boundary

- The hosted Playground has no write endpoint.
- Existing generated references and frames are explicitly treated as failed and unapproved; repair starts from `input.png` when available.
- Local submission accepts only declared frame names, valid PNG, exact `frame_size`, and at most 20 MiB.
- Replacing an existing frame is explicit and surfaced as destructive by MCP annotations.
- Deterministic QA cannot approve packing; visual QA remains separate.
