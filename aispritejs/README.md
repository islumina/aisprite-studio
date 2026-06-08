# aispritejs

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`aispritejs` 是一個極度輕量、**Rive-like（輸入驅動）的 2D 精靈動畫運行時庫 (2D Sprite Animation Runtime)**。

它旨在將 2D 精靈圖（Spritesheet）的動畫狀態機與遊戲邏輯徹底解耦。開發者不需要在遊戲代碼中手動調用動畫名稱（例如 `play('walk')`），而是透過更新簡單的輸入變數（如 `speed` 或 `isGrounded`），讓運行時根據宣告式規則自動切換動畫。

本專案完美相容於 **PixiJS v8**，並可無縫對接 [`yshengliao`](https://www.npmjs.com/~yshengliao) 的遊戲引擎生態系（如 `aiecsjs`、`aifsmjs`）。

---

## 📦 安裝 (Installation)

```bash
npm install @yshengliao/aispritejs
```

---

## 🚀 核心功能 (Key Features)

- **輸入驅動狀態機 (Input-Driven State Machine)**：支援 `Number`、`Boolean` 與 `Trigger` 三種輸入類型。
- **優先權宣告式規則 (Priority Rules Engine)**：使用簡單的陣列優先權規則取代複雜的圖形過渡，保持 **Anti-Additive（減法設計）** 的極簡架構。
- **渲染器解耦 (Renderer-Agnostic Core)**：核心邏輯與 PixiJS 徹底分離，僅負責計算「當下時間點應顯示哪個影格」，可輕鬆適配任何 2D/3D 渲染引擎。
- **PixiJS v8 官方適配器**：內建 `PixiRiveSpriteAdapter`，自動處理 WebGL 紋理更換與防止雙線性過濾的邊緣出血。

---

## 💻 快速上手 (Quick Start)

### 1. 定義規則 (atlas.json)
你的 `atlas.json` 除了包含影格座標外，只需多出一個 `"rules"` 區塊：

```json
{
  "rules": [
    {
      "state": "jump",
      "conditions": [{ "input": "isGrounded", "op": "eq", "value": false }]
    },
    {
      "state": "walk",
      "conditions": [{ "input": "speed", "op": "gt", "value": 0 }]
    },
    {
      "state": "idle",
      "conditions": []
    }
  ]
}
```

### 2. 遊戲端串接 (TypeScript)

```typescript
import * as PIXI from 'pixi.js';
import { RiveSpritePlayer, PixiRiveSpriteAdapter } from '@yshengliao/aispritejs';

// 1. 初始化 PixiJS 精靈與載入圖集
const app = new PIXI.Application();
await app.init({ width: 800, height: 600 });
const sheet = await PIXI.Assets.load('assets/reimu/atlas.json');
const pixiSprite = new PIXI.Sprite(sheet.textures['idle_00']);

// 2. 建立 Rive-like 播放器與適配器
const player = new RiveSpritePlayer(sheet.data.rules);
const adapter = new PixiRiveSpriteAdapter(player, pixiSprite, sheet);

app.stage.addChild(pixiSprite);

// 3. 在遊戲更新 Loop 中驅動
app.ticker.add((ticker) => {
  // 更新狀態機物理數值
  player.setInput('speed', playerVelocity.x);
  player.setInput('isGrounded', playerOnFloor);
  
  // 更新狀態機時間與渲染
  adapter.update(ticker.deltaTime);
});
```

---

## 🏗️ 模組規劃 (Module Structure)

```text
@yshengliao/aispritejs
  ├── dist/
  ├── src/
  │    ├── core/                  # 核心狀態機 (純 TypeScript, 0 依賴)
  │    │    ├── RiveSpritePlayer.ts
  │    │    └── Types.ts
  │    ├── adapters/              # 渲染引擎適配器
  │    │    └── PixiRiveSpriteAdapter.ts
  │    └── compiler/              # 選擇性匯出：去背與打包工具 (用於編譯期)
  │         ├── ChromaKeyer.ts
  │         └── AtlasPacker.ts    # 封裝 free-tex-packer-core
  └── package.json
```

---

## 📄 開源授權 (License)

Distributed under the MIT License. See `LICENSE` for more information.
