# AGENTS — Islumina Sprite Pipeline

> [!NOTE]
> This sprite generation pipeline is host-neutral. Codex, Claude, Gemini, Antigravity, or another image-capable agent can participate through the local MCP boundary or manual task handoff.

Two agents, sequential pipeline. No parallel execution needed.
Handles three asset categories: **Character**, **Object**, **Effect**.

## Execution & Delegation Rules

1. **NO Subagents for Image Generation**: One image-capable agent MUST own a generation sequence and retain its references. Do not split one asset across parallel agents, as this leads to style and context inconsistencies.
2. **Delegation of Scripts**: Non-creative, deterministic tasks (like running `packer.py`, QA scripts, or file copying) may be delegated or run as background tasks.
3. **Personal Inspection**: Even if tasks are delegated or run via scripts, the main agent MUST personally review the final output (e.g., checking log files, verifying completion) to ensure everything is correct before concluding the task.

## Asset Categories

| Category | Examples | Reference image | Consistency rule |
|----------|----------|----------------|------------------|
| Character | reimu, sakuya, knight | T-Pose / neutral standing | Same face, outfit, proportions across frames |
| Object | chest, door, lever, torch | Static base state (closed/off) | Body pixel-identical; only dynamic parts change |
| Effect | flame, explosion, magic circle | Representative frame | Same colour palette & bounding box; particles vary |

The `asset_type` field in `request.yml` determines which category rules apply.
If omitted, defaults to `character`.

## Agent 1: Generation Agent

**Role**: Read `request.yml` + reference image → produce the frame PNGs, either a whole animation at once (row task) or one frame at a time (frame task).

**System prompt**: `prompts/generation-agent.md`. The exact task prompt comes from the MCP server (`mcp-server/src/prompts.ts`); use it verbatim.

**Input artifacts**:
- `assets/{name}/request.yml` — animation spec (actions, directions, frame counts, style, asset_type)
- `assets/{name}/tpose.png` — reference image (T-Pose for characters, base state for objects/effects)
- `assets/{name}/input.png` — (optional) original user-provided reference

**Output artifacts**:
- Row task: `assets/{name}/raw/{animation}.png`, one picture with every pose of the animation. `aisprite_studio_submit_generated_row` keys it, finds exactly the declared number of poses by content, and writes them as frames at one shared scale, or writes nothing and says what it found.
- Frame task: `assets/{name}/frames/{action}_{direction}_{index:02d}.png` (`{action}_{index:02d}.png` without a direction).

**Choosing a mode**: row tasks keep identity, scale, and palette more consistent because the poses are drawn together. Each pose gets a slot of the 1536×1024 canvas, so the row task warns when a pose must be enlarged more than 1.25× to reach `frame_size`; prefer frame tasks then.

**Constraints**:
- When generating the initial T-Pose / reference image, prompt for "FLAT EVEN LIGHTING" and "ABSOLUTELY NO SHADOWS" (no body shadows, no ground plane shadow). This is crucial to prevent baking unwanted lighting into subsequent frames.
- Paint the background as one flat, solid chroma colour (green, or blue for a mostly green subject). The pipeline measures the painted colour per frame, so an off-spec shade is fine, but gradients, floors, shadows, or scenery make the frame unkeyable and QA rejects it.
- MUST explicitly prompt to prevent color spill from the background (e.g. "Ensure there is NO green/blue tint or spill on the character's body or clothing. Perfect original colors"). The character must NOT be interfered with by the blue/green screen.
- MUST use the connected host's native image-editing capability with the returned PNG references, not pure text-to-image
- MUST NOT add direct model API calls or API keys to this repository. Obtain the task through MCP, generate with the host capability, then submit through MCP.
- Frame tasks MUST output a 1:1 square PNG matching `frame_size` from `request.yml`; row tasks output the canvas size the task states
- MUST NOT modify files outside `assets/{name}/frames/` and `assets/{name}/raw/`
- MUST NOT deploy, publish, or run production commands
- Generate only missing frames: tasks without an explicit frame or animation select the first missing one
- If the host's image generation fails (rate limit or server error), retry up to 3 times with backoff, then report the frame as failed

**Reference image priority** for frame tasks (pass up to 3 through the host's image-input mechanism):
1. Reference image (tpose.png) — always included, visual anchor
2. Frame 0 of current animation — locks scale, palette, framing
3. Previous frame (N-1) — motion continuity

Row tasks attach the reference image and the numbered layout guide. The guide only places the poses: draw pose k in box k, and never draw the boxes, lines, or numbers.

**Repair flow** (no separate agent):
When QA fails a frame, re-generate using multi-turn image editing:
- Pass failed frame + reference + `repair_hint` from QA report → replacement frame
- Category-specific repair:
  - Characters: fix pose, proportion, or identity issues
  - Objects: realign body to reference, fix only dynamic elements
  - Effects: correct palette or bounding box drift

## Agent 2: QA Agent

**Role**: Review generated frames visually and record the verdict as `visual_qa` in `qa-report.json`, after the deterministic QA below has run.

**System prompt**: `prompts/qa-agent.md`

**Input artifacts**:
- `assets/{name}/frames/*.png` — generated frames
- `assets/{name}/tpose.png` — reference for consistency check
- `assets/{name}/request.yml` — expected frame list + asset_type

**Output artifacts**:
- `assets/{name}/qa-report.json` — structured validation report

**Deterministic checks** (`python3 -m tools.sprite_pipeline.cli qa`, or `aisprite_studio_run_deterministic_qa`, which also returns a scored summary):
1. **Per frame**: the file exists and is PNG data (a renamed JPEG fails with its real format), dimensions match `frame_size`, the background is one keyable chroma colour, the keyed subject covers 5–95% of the frame, and its centroid does not jump from the previous frame.
2. **Per animation**: duplicate frames (including a last frame that copies frame 0) and no motion, scale drift and colour drift against the surrounding frames, and a subject touching the canvas edge.
3. **Score and hints**: each animation gets a 0–100 score, `issues`, and `hints`; the report's `score` is the lowest animation score. Every failing frame gets a `repair_hint` the Generation Agent can act on.

**Vision QA** (this agent, only after the deterministic checks pass): subject consistency, pose/state accuracy, and inter-frame stability, category-aware (characters check identity, objects body stability, effects palette). Record the result as `"visual_qa": {"status": "pass" | "fail", ...}`. Re-running deterministic QA rewrites the report, so record the visual verdict last.

**Constraints**:
- MUST NOT modify frame files
- MUST NOT re-generate frames (that's the generation agent's job)
- A deterministic score of 100 is never visual approval

## Pipeline Order

```
request.yml + tpose.png
        │
        ▼
  ┌─────────────┐
  │  Generation  │  → frames/*.png
  │    Agent     │
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │   QA Agent   │  → qa-report.json (+ repair_hints)
  └──────┬──────┘
         │
    ┌────┴────┐
    │ Failed? │──yes──→ Generation Agent (repair flow)
    └────┬────┘              │
         │ no                ▼
         ▼            QA Agent (re-validate)
  ┌─────────────┐
  │   Packer     │  → {asset}.webp + atlas.json
  │  (no agent)  │
  └─────────────┘
```

Packer is a deterministic script, not an agent. It runs only when `qa-report.json`
has `overall: "pass"` and `visual_qa.status: "pass"`. It keys, trims, and
shelf-packs the declared frames into `{asset}.webp` (`{asset}.png` without
`cwebp`) and writes `atlas.json`, keeping anchors, durations, and the state graph
already tuned in the editor. No LLM involvement.

## Shared Schema

All agents reference `schemas/atlas.schema.json` for output format.
Frame naming convention: `{action}_{direction}_{index:02d}.png`, or `{action}_{index:02d}.png` when `direction` is empty
Actions, directions, and asset_type are defined in `request.yml`.

## request.yml Format

```yaml
character: chest           # asset identifier
style: 3d cartoon game     # art style descriptor
frame_size: 1024           # px, square
asset_type: object         # character | object | effect (default: character)

animations:
  - action: open
    direction: front       # optional; empty for subjects without a facing
    frames: 6
    fps: 10                # optional; default 8
  - action: shine
    direction: front
    frames: 4
```

## Previewing with MCP

When using MCP (e.g. `chrome-devtools`) to preview the output or test the flow, **always navigate to the project root URL (`http://localhost:8080/`)**, NOT `/webeditor/`. The Node.js server (`server.mjs`) routes the root URL to the web editor directory automatically.
