# AI Playbook — Sprite Pipeline & Interactive Web Editor

> [!NOTE]
> This repository is a hobby toy project built on Google's **antigravity** SDK.

AI Playbook is a workflow-optimised development platform for game sprite generation, QA validation, spritesheet packing, and interactive PixiJS-based animation tuning with FSM state machine support.

---

## Key Features

1. **AI-Assisted Sprite Generation**: Frame-by-frame PNG generation from a reference image (T-Pose) using Google Antigravity's image editing mode.
2. **Automated QA Validator**: Scripts verifying image integrity, dimensions, alpha coverage, and vision-based character consistency.
3. **Optimised Grid Packer**: Packs raw animation frames into a single spritesheet with `atlas.json` metadata and automatic WebP compression.
4. **Interactive PixiJS Web Editor**:
   - **Visual Timeline Scrubber**: Per-frame duration editing with instant preview.
   - **Pivot Tuning**: Drag-and-drop anchor adjustment with keyboard fine-tuning.
   - **Viewport Pan & Zoom**: Scroll wheel zoom and right-click viewport dragging.
   - **Chroma Key Transparency**: Live green-screen keying with tolerance configuration.
   - **FSM State Machine**: `aifsmjs` runtime for sequential state transitions (e.g. non-looping `open` → looping `shine`).
   - **Direct Disk Save**: `POST /api/save` persists atlas JSON and exports transparent `{char}_keyed.png` in one click.

---

## Quick Start

### 1. Prerequisites & AI Agent Setup

To run and build this project, you need an AI assistant (such as Google Antigravity Agent or a similar coding agent) equipped with terminal execution and image generation capabilities.

Simply initiate a new session with your AI Agent in this workspace and send the **First Prompt** (see the [AI Assistant Integration](#ai-assistant-integration-for-new-sessions) section below). 

The agent will read [SKILL.md](./SKILL.md) and automatically set up the environment and dependencies:
* **Python virtual environment** & packages (`requirements.txt`)
* **Homebrew packages** (`webp`, `oxipng`, `optipng`) for image processing and compression

*(If you prefer manual setup, please refer to the commands inside [SKILL.md](./SKILL.md).)*

### 2. Quick Preview (No Generation Needed)

The repository comes with pre-generated, bundled demonstration assets (e.g., `reimu`, `sakuya`, `chest`, `fireball`). You can spin up the interactive web editor instantly to play with them:

```bash
# Start local backend server (Listens on all network interfaces by default)
python3 serve.py
```
> **Warning**: The dev server binds to `0.0.0.0` and is visible to other devices on your local network. It is intentionally designed this way for LAN testing, but it has no authentication. Please do not run it on untrusted public networks.

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
python3 -m tools.ag-sprite.cli generate assets/my_hero
```
This script will analyze your request and output a precise **Generation Plan** text. 

#### Step C: Hand off to the Antigravity Agent
Copy the generated plan text and send it to your Antigravity Agent (invoked as Subagent Type: `self` to grant file write permissions). The agent will iteratively call the `generate_image` tool to render all animation frames and save them directly to your local `assets/my_hero/frames/` directory.

#### Step D: Run QA & Pack
Once the agent finishes generating the frames, run the QA test and compiler:
```bash
# Verify frame dimensions, transparency, etc.
python3 -m tools.ag-sprite.cli qa assets/my_hero --skip-vision

# Compile raw frames into the final spritesheet + atlas.json
python3 -m tools.ag-sprite.cli pack assets/my_hero
```

Open `http://localhost:8080/?char=my_hero` to preview and fine-tune your new custom sprite sheet!

---

## AI Assistant Integration (For New Sessions)

> [!IMPORTANT]
> **Platform Support**: Currently, this project has only been tested and verified on **macOS**.

When starting a new chat session with your AI coding assistant (e.g. Gemini, Claude) in this workspace, you can use the following prompts to kickstart and streamline the workflow.

### 1. First Prompt to Start the Session
Paste this prompt immediately when you open a new session in this workspace:
```
We are developing this sprite generation project built on the Google `antigravity` SDK. Please read SKILL.md to understand the workflow and constraints. Once read, run the environment diagnostic commands listed in Section 1 of SKILL.md to check if my Python virtual environment, dependencies, and compression tools (like cwebp) are properly configured. If any dependencies (Python packages or Homebrew packages like cwebp, oxipng) are missing, please go ahead and automatically install them for me using pip or brew without asking for permission, then report back.
```

### 2. Common Subsequent Prompts (Great for Non-Developers/Artists)
Here are handy prompts you (or your team's artists) can send to the assistant without touching the terminal:

* **To Start the Editor Server**:
  ```
  Please start the local backend server (serve.py) for the Web Editor. Once running, provide me with the HTTP localhost link so I can open it in my browser.
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
│   │   ├── fsm.js           # aifsmjs state machine binder
│   │   ├── prompt-builder.js # Prompt synthesis for regeneration
│   │   └── ...              # bus, timeline, keyboard, chroma, etc.
│   └── vendor/              # Vendored libs (PixiJS, ai*js)
├── tools/ag-sprite/         # Python tooling (QA + Packer)
├── prompts/                 # Agent prompt templates
├── schemas/                 # JSON schema (atlas.schema.json)
├── docs/                    # Documentation & smoke test
├── serve.py                 # Backend HTTP server
├── AGENTS.md                # Agent pipeline specification
└── SKILL.md                 # Agent session startup guide
```

---

## Vendor Dependencies

The `webeditor/vendor/` directory contains minified ESM snapshots of `yshengliao/*` npm packages. These are vendored directly to allow the editor to run without a build step. If updates are needed, please fetch from the upstream npm repository rather than modifying the vendored files manually.

---

## FSM State Tuning Example

For composite animations (e.g. treasure chest), configure sequential FSM states in `atlas.json`:

```json
"states": {
  "initial": "open",
  "definitions": {
    "open": {
      "animation": "open_front",
      "onEnd": "shine",
      "transitions": {}
    },
    "shine": {
      "animation": "shine_front",
      "onEnd": "loop",
      "transitions": {}
    }
  }
}
```

**Result**: The chest plays the opening sequence once, then auto-transitions to the looping sparkle animation via `ANIM_END`.

---

## Intellectual Property & License

### Touhou Project Content
Most character examples included in the `assets/` directory (e.g., `reimu`, `sakuya`) are derived from the **Touhou Project** (東方Project). The intellectual property of these characters belongs to **Team Shanghai Alice** (上海アリス幻樂団) and **ZUN**. These assets are included strictly as non-commercial development samples.

### License
This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

Author: ysl
