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

**Role**: Read `request.yml` + reference image → produce individual frame PNGs.

**System prompt**: `prompts/generation-agent.md`

**Input artifacts**:
- `assets/{name}/request.yml` — animation spec (actions, directions, frame counts, style, asset_type)
- `assets/{name}/tpose.png` — reference image (T-Pose for characters, base state for objects/effects)
- `assets/{name}/input.png` — (optional) original user-provided reference

**Output artifacts**:
- `assets/{name}/frames/{action}_{direction}_{index:02d}.png` — individual frames

**Constraints**:
- When generating the initial T-Pose / reference image, prompt for "FLAT EVEN LIGHTING" and "ABSOLUTELY NO SHADOWS" (no body shadows, no ground plane shadow). This is crucial to prevent baking unwanted lighting into subsequent frames.
- MUST explicitly prompt to prevent color spill from the background (e.g. "Ensure there is NO green/blue tint or spill on the character's body or clothing. Perfect original colors"). The character must NOT be interfered with by the blue/green screen.
- MUST use the connected host's native image-editing capability with the returned PNG references, not pure text-to-image
- MUST NOT add direct model API calls or API keys to this repository. Obtain the task through MCP, generate with the host capability, then submit through MCP.
- MUST output 1:1 square aspect ratio matching `frame_size` from `request.yml`
- MUST NOT modify files outside `assets/{name}/frames/`
- MUST NOT deploy, publish, or run production commands
- Use content-hash cache (`.sprite-pipeline-cache/`) to skip already-generated frames
- On API failure (429/5xx): retry 3× with exponential backoff, then mark frame as failed

**Reference image priority** (pass up to 3 through the host's image-input mechanism):
1. Reference image (tpose.png) — always included, visual anchor
2. Frame 0 of current animation — locks scale, palette, framing
3. Previous frame (N-1) — motion continuity

**Repair flow** (no separate agent):
When QA fails a frame, re-generate using multi-turn image editing:
- Pass failed frame + reference + `repair_hint` from QA report → replacement frame
- Category-specific repair:
  - Characters: fix pose, proportion, or identity issues
  - Objects: realign body to reference, fix only dynamic elements
  - Effects: correct palette or bounding box drift

## Agent 2: QA Agent

**Role**: Validate generated frames → produce `qa-report.json`.

**System prompt**: `prompts/qa-agent.md`

**Input artifacts**:
- `assets/{name}/frames/*.png` — generated frames
- `assets/{name}/tpose.png` — reference for consistency check
- `assets/{name}/request.yml` — expected frame list + asset_type

**Output artifacts**:
- `assets/{name}/qa-report.json` — structured validation report

**Checks** (ordered by cost):
1. **File check**: all expected frames exist, non-zero size, valid PNG
2. **Dimension check**: all frames match `frame_size` in `request.yml`
3. **Alpha coverage**: if chroma-keyed, non-transparent area is 5–95% of frame
4. **Vision QA** (API call): subject consistency, pose/state accuracy, inter-frame stability
   - Category-aware: characters check identity, objects check body stability, effects check palette
   - Only called if checks 1-3 pass (skip expensive API call for obvious failures)
5. **repair_hint**: if a frame fails, provide actionable one-line fix for Generation Agent

**Constraints**:
- MUST NOT modify frame files
- MUST NOT re-generate frames (that's the generation agent's job)
- MUST write `qa-report.json` even if all frames pass

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
  │   Packer     │  → spritesheet.png + atlas.json + .webp
  │  (no agent)  │
  └─────────────┘
```

Packer is a deterministic script, not an agent. It reads `frames/` and outputs
the final spritesheet + atlas JSON + WebP compressed version. No LLM involvement.

## Shared Schema

All agents reference `schemas/atlas.schema.json` for output format.
Frame naming convention: `{action}_{direction}_{index:02d}.png`
Actions, directions, and asset_type are defined in `request.yml`.

## request.yml Format

```yaml
character: chest           # asset identifier
style: 3d cartoon game     # art style descriptor
frame_size: 1024           # px, square
asset_type: object         # character | object | effect (default: character)

animations:
  - action: open
    direction: front
    frames: 6
  - action: shine
    direction: front
    frames: 4
```

## Previewing with MCP

When using MCP (e.g. `chrome-devtools`) to preview the output or test the flow, **always navigate to the project root URL (`http://localhost:8080/`)**, NOT `/webeditor/`. The Node.js server (`server.mjs`) routes the root URL to the web editor directory automatically.
