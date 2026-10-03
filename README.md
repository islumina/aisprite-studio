# AI Sprite Studio — Sprite Pipeline & Interactive Web Editor

> [!NOTE]
> This repository is an experimental hobby project. Its local MCP handoff supports Codex, Claude, Gemini, Antigravity, and other image-capable agents.

AI Sprite Studio is a workflow-optimised development platform for game sprite generation, QA validation, spritesheet packing, and interactive PixiJS-based animation tuning with state-graph support.

> The bundled generated assets are known failure fixtures for pipeline and editor testing. They are not visual-quality references, and deterministic checks alone must not be treated as visual approval.

---

## Key Features

1. **AI-Assisted Sprite Generation** through an MCP-connected, image-capable agent. The repository holds no model API key; the host generates the images.
   - **Row tasks**: the agent draws every pose of an animation in one image on a numbered layout guide. Poses drawn side by side keep identity, scale, and palette more consistent. The pipeline finds the poses by content, refuses the row unless it holds exactly the declared number, and fits them at one shared scale.
   - **Frame tasks**: one frame at a time, with the reference, frame 0, and the previous frame attached. Better for large `frame_size`, where a row would enlarge each pose.
2. **Chroma Keying**: each frame's background colour is measured from its own border (generators rarely paint the exact hex), removed, and edge pixels and painted-on glows are unmixed from it, so edges keep their own colour. A background that is not one solid, saturated colour is refused instead of guessed.
3. **Deterministic QA with Scores and Repair Hints**: file format, dimensions, keyability, coverage, and centroid drift per frame; duplicate frames, no motion, scale drift, colour drift, and edge contact per animation. Each animation gets a 0–100 score and actionable hints for the image agent. Visual approval stays a separate gate.
4. **Packer**: keyed frames are trimmed, identical frames share one rect, and rects are shelf-packed with a gutter into a WebP sheet. `atlas.json` loads in PixiJS and, through its Aseprite `frameTags`, in Phaser's `load.aseprite`. Re-packing keeps the anchors, durations, and state graph tuned in the editor.
5. **Interactive PixiJS Web Editor**:
   - **Visual Timeline Scrubber**: per-frame duration editing with instant preview.
   - **Pivot Tuning**: drag-and-drop anchor adjustment with keyboard fine-tuning; onion skin.
   - **Viewport Pan & Zoom**: scroll-wheel zoom and right-click dragging, sharp on high-DPI screens.
   - **GPU Chroma Key**: keys opaque sheets and the T-Pose with each image's own border colour; sheets that already have alpha are left alone.
   - **Sprite Runtime**: `aispritejs` drives the atlas state graph with deterministic frame timing. Declared number inputs map to WASD and the first trigger to Space.
   - **Prompt Panels**: show the exact task the MCP server gives an agent for the selected animation or frame.
   - **Direct Disk Save**: `POST /api/save` persists the atlas JSON and an optional keyed PNG.
   - **Host Bridge**: `aibridgejs` exposes bounded iframe commands and read-only editor context to an embedding page; image submission remains local MCP-only.
   - **Viewer Mode**: at 900 px wide or less the editor becomes a read-only player.

The CLI pack step is gated: `qa-report.json` must contain both `overall: "pass"` and `visual_qa.status: "pass"`. Deterministic checks or `--skip-vision` alone cannot approve generated art.

---

## Quick Start

### 1. Prerequisites & AI Agent Setup

To generate artwork, use an image-capable AI assistant with local MCP or manual task handoff. Preview, deterministic QA, and packing do not require a model API key.

Start a new session with your AI agent in this workspace and send the **First Prompt** (see [AI Assistant Integration](#ai-assistant-integration-for-new-sessions) below). The agent reads [SKILL.md](./SKILL.md) and sets up:
* **Node.js 22.12+** for the local editor server and MCP bridge
* **Python 3.10+** with `requirements.txt` (Pillow, NumPy, PyYAML, jsonschema) for keying, QA, and packing
* **`cwebp`** (Homebrew `webp`, optional) for the WebP sheet

*(For manual setup, see the commands in [SKILL.md](./SKILL.md).)*

### 2. Quick Preview (No Generation Needed)

The repository includes known-failed fixtures (`chest`, `clownfish`, `fireball`, `reimu`, `sakuya`) for exercising the pipeline and editor. They are not approved art assets.

```bash
npm ci
npm run serve
```

The server binds to `127.0.0.1` by default. For deliberate LAN testing, set `AISPRITE_STUDIO_HOST=0.0.0.0` and open the editor by IP address with `?mode=local` (e.g. `http://192.168.1.20:8080/?mode=local`); the server answers only loopback names and IP literals, and it has no authentication, so do not expose it on an untrusted network.

Open `http://localhost:8080/?char=reimu`. Use the timeline scrubber, pivot adjustments, and chroma key panel.

---

### 3. Custom Sprite Generation Pipeline

#### Step A: Set up the asset folder
1. Create `assets/my_hero/`.
2. Add `assets/my_hero/request.yml` (format below).
3. Place a canonical reference `assets/my_hero/tpose.png`: a clean, neutral front pose on one solid chroma colour (green, or blue for a mostly green subject). The MCP reference task can create or repair it.

#### Step B: Generate frames through an image-capable agent
Connect the local MCP server, then either:
- **Row**: call `aisprite_studio_get_row_task`, draw the whole animation in one image with the returned reference and layout guide, and submit it with `aisprite_studio_submit_generated_row`; or
- **Frame**: call `aisprite_studio_get_generation_task`, generate that frame with every returned reference, and submit it with `aisprite_studio_submit_generated_frame`.

The row task warns when poses would be enlarged more than 1.25× to reach `frame_size`; prefer frame tasks then. Hosts without MCP can print every pending frame task with `npm run plan -- assets/my_hero`, or use the editor's **Copy active frame task**, and pass the PNG to an MCP-connected agent for validated submission.

#### Step C: Run QA and repair
```bash
python3 -m tools.sprite_pipeline.cli qa assets/my_hero --skip-vision
```
QA prints the lowest animation score and its hints; `qa-report.json` holds every check, a `repair_hint` per failing frame, and per-animation `score`, `issues`, and `hints`. Regenerate what it names and run QA again.

#### Step D: Visual review and pack
After a person (or a vision-capable agent) has reviewed the frames, record the result in `qa-report.json` as `"visual_qa": {"status": "pass"}`. Running QA again rewrites the report, so review last. Then:
```bash
python3 -m tools.sprite_pipeline.cli pack assets/my_hero
```
`pack --fresh` ignores the anchors, durations, and states saved in an existing `atlas.json`.

Open `http://localhost:8080/?char=my_hero` to preview and fine-tune the sheet.

### request.yml format

```yaml
character: chest           # asset identifier
style: 3d cartoon game     # art style descriptor
frame_size: 1024           # px, square
asset_type: object         # character | object | effect (default: character)

animations:
  - action: open
    direction: front       # optional; empty for subjects without a facing (frames are then open_00 ...)
    frames: 6
    fps: 10                # optional; default 8
  - action: shine
    direction: front
    frames: 4
```

Frames are named `{action}_{direction}_{index:02d}.png` (`{action}_{index:02d}.png` without a direction).

---

## AI Assistant Integration (For New Sessions)

> [!IMPORTANT]
> **Platform Support**: Currently, this project has only been tested and verified on **macOS**.

When starting a new chat session with Codex, Claude, Gemini, Antigravity, or another coding assistant in this workspace, use the following prompt to enter the same workflow.

### 1. First Prompt to Start the Session
```
We are developing AI Sprite Studio. Read SKILL.md and AGENTS.md, then run the environment diagnostics in SKILL.md. Report missing dependencies before installing system packages. Treat all checked-in generated images as failed and unapproved. Use the local aisprite-studio MCP workflow for reference repair, row or frame tasks, validated PNG submission, and deterministic QA; visual approval remains a separate human gate.
```

### 2. Common Subsequent Prompts (Great for Non-Developers/Artists)

* **To Start the Editor Server**:
  ```
  Please start the local Web Editor server with `npm run serve`. Once running, provide me with the HTTP localhost link so I can open it in my browser.
  ```
* **To Begin AI Sprite Generation**:
  ```
  I have set up my character folder under "assets/my_char/" with request.yml and tpose.png. Please generate the animations through the aisprite-studio MCP server, run QA after each one, and repair what QA flags.
  ```
* **To Pack and Compile Sprites**:
  ```
  I have reviewed the frames and they look good. Please record the visual approval in qa-report.json and pack the spritesheet. Tell me how to reload and preview it in the Web Editor once done.
  ```

---

## Directory Structure

```
├── assets/                  # Known-failure fixtures: chest, clownfish, fireball, reimu, sakuya
│   └── <asset>/
│       ├── request.yml      # Animation specification
│       ├── tpose.png        # Canonical reference
│       ├── input.png        # Optional original reference
│       ├── frames/          # Frame PNGs, one per declared frame
│       ├── raw/             # Row-task pictures (raw/<animation>.png) and their extraction reports
│       ├── output/          # atlas.json + sheet .webp (the packed .png is not committed)
│       └── qa-report.json
├── webeditor/               # Web editor (plain ES modules, no build step)
│   ├── index.html
│   ├── style.css
│   ├── src/
│   │   ├── editor.js        # Main controller
│   │   ├── preview.js       # PixiJS renderer and playback
│   │   ├── runtime.js       # aispritejs animator for the atlas state graph
│   │   ├── chroma-filter.js # GPU chroma key
│   │   ├── prompts.js       # Prompt panels (MCP tasks, static demo prompts)
│   │   └── ...              # agent-handoff, pose-panels, viewport, timeline, keyboard, bus, constants
│   └── vendor/              # Vendored PixiJS and ai*js
├── tools/sprite_pipeline/   # Python: chroma, qa, qa_sequence, row, packer, spec, cli
├── mcp-server/              # MCP server (TypeScript; dist/ is committed)
├── prompts/                 # Agent system prompts
├── schemas/                 # atlas.schema.json
├── docs/                    # Smoke test checklist
├── server.mjs               # Local editor server and API
├── AGENTS.md                # Agent pipeline specification
└── SKILL.md                 # Agent session startup guide
```

---

## Vendor Dependencies

`webeditor/vendor/` holds pinned ESM copies of PixiJS and the `islumina/*` packages so the editor runs without a build step. They are copied from `node_modules` at the exact versions in `package.json`: run `npm ci`, then `npm run vendor:update`. `npm run vendor:check` (also in CI) fails unless the vendored files match, byte for byte, what an update would write. To vendor an unreleased build, install it first, e.g. `npm install --no-save ../aispritejs`.

## AI agent connection (MCP)

The [`mcp-server`](./mcp-server/) lets MCP-capable AI clients take part in the workflow without putting a model API key in the browser. Over local stdio it exposes declared assets, reference repair, row and frame tasks with PNG references, validated image submission, and deterministic QA with a scored summary. Existing generated images are explicitly treated as failed and unapproved. Run `npm ci && npm run test:mcp` from the repository root, then copy the client configuration from the editor's **AI Agent Handoff** card.

The hosted Playground is read-only. Write access remains local and constrained to declared `assets/{asset}/frames/{frame}.png` and `assets/{asset}/raw/{animation}.png` paths; deterministic QA never counts as visual approval.

---

## Sprite State Tuning Example

Atlases use the `aispritejs` input-driven graph. A non-looping state can return to another state with `onEnd`:

```json
"states": {
  "open": { "animation": "open_front", "loop": false, "onEnd": "shine" },
  "shine": { "animation": "shine_front", "loop": true }
},
"inputs": {},
"transitions": [],
"initial": "open"
```

**Result**: `aispritejs` plays the opening sequence once, then deterministically enters the looping sparkle state.

---

## Acknowledgements

Row generation with a layout guide, per-frame key measurement with edge unmixing, and sequence QA with repair hints were inspired by [aldegad/sprite-gen](https://github.com/aldegad/sprite-gen) (Apache-2.0). This project reimplements the ideas and contains none of its code.

## Intellectual Property & License

### Touhou Project Content
Most character examples included in the `assets/` directory (e.g., `reimu`, `sakuya`) are derived from the **Touhou Project** (東方Project). The intellectual property of these characters belongs to **Team Shanghai Alice** (上海アリス幻樂団) and **ZUN**. These assets are included strictly as non-commercial development samples.

### License
This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

Author: ysl
