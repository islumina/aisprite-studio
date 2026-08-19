# AI Sprite Studio — Sprite Pipeline & Interactive Web Editor

> [!NOTE]
> This repository is an experimental hobby project. Its local MCP handoff supports Codex, Claude, Gemini, Antigravity, and other image-capable agents.

AI Sprite Studio is a workflow-optimised development platform for game sprite generation, QA validation, spritesheet packing, and interactive PixiJS-based animation tuning with FSM state machine support.

> The bundled generated assets are known failure fixtures for pipeline and editor testing. They are not visual-quality references, and deterministic file checks alone must not be treated as visual approval.

---

## Key Features

1. **AI-Assisted Sprite Generation**: Frame-by-frame PNG generation from a reference image through an MCP-connected, image-capable agent.
2. **Automated QA Validator**: Scripts verifying image integrity, dimensions, alpha coverage, and vision-based character consistency.
3. **Optimised Grid Packer**: Packs raw animation frames into a single spritesheet with `atlas.json` metadata and automatic WebP compression.
4. **Interactive PixiJS Web Editor**:
   - **Visual Timeline Scrubber**: Per-frame duration editing with instant preview.
   - **Pivot Tuning**: Drag-and-drop anchor adjustment with keyboard fine-tuning.
   - **Viewport Pan & Zoom**: Scroll wheel zoom and right-click viewport dragging.
   - **Chroma Key Transparency**: Live green-screen keying with tolerance configuration.
   - **Sprite Runtime**: `aispritejs` drives input-based visual states and deterministic frame timing; legacy event-based atlases remain supported through `aifsmjs`.
   - **Direct Disk Save**: `POST /api/save` persists atlas JSON and exports transparent `{char}_keyed.png` in one click.
   - **Host Bridge**: `aibridgejs` exposes bounded iframe commands and read-only editor context to an embedding page; image submission remains local MCP-only.

The CLI pack step is gated: `qa-report.json` must contain both `overall: "pass"` and `visual_qa.status: "pass"`. Deterministic checks or `--skip-vision` alone cannot approve generated art.

---

## Quick Start

### 1. Prerequisites & AI Agent Setup

To generate artwork, use an image-capable AI assistant with local MCP or manual task handoff. Preview, deterministic QA, and packing do not require a model API key.

Simply initiate a new session with your AI Agent in this workspace and send the **First Prompt** (see the [AI Assistant Integration](#ai-assistant-integration-for-new-sessions) section below). 

The agent will read [SKILL.md](./SKILL.md) and automatically set up the environment and dependencies:
* **Node.js 22.12+** for the local editor server and MCP bridge
* **Python virtual environment** & packages (`requirements.txt`) for image QA and packing
* **Homebrew packages** (`webp`, `oxipng`, `optipng`) for image processing and compression

*(If you prefer manual setup, please refer to the commands inside [SKILL.md](./SKILL.md).)*

### 2. Quick Preview (No Generation Needed)

The repository includes known-failed image fixtures (e.g., `reimu`, `sakuya`, `chest`, `fireball`) for exercising the pipeline and editor. They are not approved art assets. You can spin up the interactive web editor to inspect them:

```bash
# Start the local-only backend server
npm ci
npm run serve
```

The server binds to `127.0.0.1` by default. For deliberate LAN testing, set `AISPRITE_STUDIO_HOST=0.0.0.0`; the development server has no authentication, so do not expose it on an untrusted network.

Open `http://localhost:8080/?char=reimu` in your browser. Use the timeline scrubber, pivot adjustments, and chroma key panel.

---

### 3. Custom Sprite Generation Pipeline

To create your own custom character or object spritesheet using the AI-assisted pipeline, follow these steps:

#### Step A: Setup Asset Folder
1. Create a subdirectory under `assets/` (e.g., `assets/my_hero`).
2. Add `assets/my_hero/request.yml` specifying your animations (see request.yml format below).
3. Place a canonical reference image `assets/my_hero/tpose.png` (a clean neutral standing pose / front view / solid green background).

#### Step B: Generate Generation Plan for the Agent
Run the generate CLI command locally:
```bash
python3 -m tools.sprite_pipeline.cli generate assets/my_hero
```
This script will analyze your request and output a precise **Generation Plan** text. 

#### Step C: Hand off to an image-capable agent
Connect the local MCP server, call `aisprite_studio_get_generation_task`, generate the exact requested frame with every returned PNG reference, then submit it with `aisprite_studio_submit_generated_frame`. Hosts without MCP can use the editor's **Copy active frame task** action and pass the resulting PNG to an MCP-connected agent for validated submission.

#### Step D: Run QA & Pack
Once the agent finishes generating the frames, run the QA test and compiler:
```bash
# Verify frame dimensions, transparency, etc.
python3 -m tools.sprite_pipeline.cli qa assets/my_hero --skip-vision

# Compile raw frames into the final spritesheet + atlas.json
python3 -m tools.sprite_pipeline.cli pack assets/my_hero
```

Open `http://localhost:8080/?char=my_hero` to preview and fine-tune your new custom sprite sheet!

---

## AI Assistant Integration (For New Sessions)

> [!IMPORTANT]
> **Platform Support**: Currently, this project has only been tested and verified on **macOS**.

When starting a new chat session with Codex, Claude, Gemini, Antigravity, or another coding assistant in this workspace, use the following prompt to enter the same workflow.

### 1. First Prompt to Start the Session
Paste this prompt immediately when you open a new session in this workspace:
```
We are developing AI Sprite Studio. Read SKILL.md and AGENTS.md, then run the environment diagnostics in SKILL.md. Report missing dependencies before installing system packages. Treat all checked-in generated images as failed and unapproved. Use the local aisprite-studio MCP workflow for reference repair, exact frame tasks, validated PNG submission, and deterministic QA; visual approval remains a separate human gate.
```

### 2. Common Subsequent Prompts (Great for Non-Developers/Artists)
Here are handy prompts you (or your team's artists) can send to the assistant without touching the terminal:

* **To Start the Editor Server**:
  ```
  Please start the local Web Editor server with `npm run serve`. Once running, provide me with the HTTP localhost link so I can open it in my browser.
  ```
* **To Begin AI Sprite Generation**:
  ```
  I have set up my character folder under "assets/my_char/" with request.yml and tpose.png. Please generate the generation plan first, then proceed to generate all the remaining animation frames sequentially.
  ```
* **To Pack and Compile Sprites**:
  ```
  The generated frames look good. Please run the QA validation and compile them into the final spritesheet (pack). Tell me how to reload and preview it in the Web Editor once done.
  ```

---

## Directory Structure

```
├── assets/                  # Game assets
│   ├── chest/               # 3D Treasure Chest (open → shine FSM)
│   ├── flame/               # Fire effect (burn loop)
│   ├── reimu/               # Reimu character (idle, walk, attack)
│   └── sakuya/              # Sakuya character (idle)
│       ├── frames/          # Raw PNG frames
│       ├── output/          # Spritesheet, atlas.json, WebP
│       ├── input.png        # Original reference image
│       ├── tpose.png        # T-Pose / canonical reference
│       └── request.yml      # Animation specification
├── webeditor/               # Web-based sprite editor
│   ├── index.html           # Editor entry page
│   ├── style.css            # Editor styles (extracted)
│   ├── src/                 # JS modules
│   │   ├── editor.js        # Main controller
│   │   ├── preview.js       # PixiJS renderer, zoom, viewport
│   │   ├── runtime.js       # aispritejs runtime + legacy aifsmjs compatibility
│   │   ├── fsm.js           # legacy aifsmjs state machine binder
│   │   ├── prompt-builder.js # Prompt synthesis for regeneration
│   │   └── ...              # bus, timeline, keyboard, chroma, etc.
│   └── vendor/              # Vendored libs (PixiJS, ai*js)
├── tools/sprite_pipeline/   # Python image kernel (QA + Packer)
├── prompts/                 # Agent prompt templates
├── schemas/                 # JSON schema (atlas.schema.json)
├── docs/                    # Documentation & smoke test
├── server.mjs              # Node.js backend HTTP server
├── AGENTS.md                # Agent pipeline specification
└── SKILL.md                 # Agent session startup guide
```

---

## Vendor Dependencies

The `webeditor/vendor/` directory contains pinned ESM snapshots of the `islumina/*` packages so the editor runs without a build step. Run `npm run vendor:update` after building the sibling ai*js repositories. Local package versions must match the exact versions in `package.json`; otherwise the update fails unless an intentional upgrade passes `--allow-version-mismatch`.

## AI agent connection (MCP)

The optional [`mcp-server`](./mcp-server/) lets MCP-capable AI clients participate in the editor workflow without putting a model API key in the browser. It exposes declared assets, reference repair, exact frame prompts, PNG references, validated image submission, and deterministic QA over local stdio. Existing generated images are explicitly treated as failed and unapproved. Run `npm ci && npm run test:mcp` from the repository root, then copy the generated client configuration from the editor's **AI Agent Handoff** card.

The hosted Playground is read-only. Write access remains local and constrained to declared `assets/{asset}/frames/{frame}.png` paths; deterministic QA never counts as visual approval.

---

## Sprite State Tuning Example

New atlases use the `aispritejs` input-driven graph. A non-looping state can return to another state with `onEnd`:

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

## Intellectual Property & License

### Touhou Project Content
Most character examples included in the `assets/` directory (e.g., `reimu`, `sakuya`) are derived from the **Touhou Project** (東方Project). The intellectual property of these characters belongs to **Team Shanghai Alice** (上海アリス幻樂団) and **ZUN**. These assets are included strictly as non-commercial development samples.

### License
This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

Author: ysl
