# AI Sprite Studio MCP server

Local stdio bridge that lets MCP-capable AI clients inspect sprite workspaces, repair the canonical reference, receive exact row or frame prompts plus PNG references, submit generated images, and run deterministic QA.

The server never calls an image API and stores no API key. Image generation remains a capability of the connected AI host. Submitted files are validated as PNG and limited to 20 MiB:
- frames go to declared `assets/{asset}/frames/{frame}.png` paths and must match `frame_size`;
- row pictures go to `assets/{asset}/raw/{animation}.png` (64–4096 px per side) and are cut into the animation's declared frames by the Python pipeline, all or none.

## Setup

Run from the repository root so the workspace lockfile installs both the editor and MCP dependencies. Row extraction and QA run the Python pipeline, so `requirements.txt` must be installed for `python3`:

```bash
npm ci
npm run test:mcp
```

Example client configuration:

```json
{
  "mcpServers": {
    "aisprite-studio": {
      "command": "node",
      "args": ["/absolute/path/to/aisprite-studio/mcp-server/dist/index.js"],
      "env": {
        "AISPRITE_STUDIO_ROOT": "/absolute/path/to/aisprite-studio"
      }
    }
  }
}
```

See [CLIENTS.md](./CLIENTS.md) for Codex, Claude, Gemini CLI, and Antigravity/manual handoff examples.

## Agent workflow

1. `aisprite_studio_list_assets`
2. If the reference is failed: `aisprite_studio_get_reference_task`, generate one replacement, then `aisprite_studio_submit_reference`.
3. After visual reference approval, either:
   - `aisprite_studio_get_row_task`, draw the whole animation in one image with the reference and layout guide, then `aisprite_studio_submit_generated_row`; or
   - `aisprite_studio_get_generation_task`, generate that frame with all returned references, then `aisprite_studio_submit_generated_frame`.

   The row task returns a `warning` when poses would be enlarged more than 1.25× to reach `frame_size`; prefer frame tasks then.
4. `aisprite_studio_run_deterministic_qa`: returns a `summary` with the overall status, the lowest animation score, per-animation scores and hints, and failing frames with their `repair_hint`. Regenerate what it names.
5. `aisprite_studio_get_qa_report` for the full report.

All bundled generated images are treated as failed, unapproved artifacts. Submitting a replacement does not approve it. Deterministic QA is not visual approval, and the existing pack gate still requires an explicit visual QA pass.
