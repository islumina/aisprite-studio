# AI Sprite Studio — 互動式 Sprite 編輯器與合圖打包工具

> [!NOTE]
> 本專案是實驗性 hobby project，本機 MCP handoff 支援 Codex、Claude、Gemini、Antigravity 與其他具備生圖能力的 agent。

AI Sprite Studio 是一個專為遊戲美術資產設計的開發平台，支援 AI 動態影格生成、自動 QA 驗證、合圖編譯，以及基於 PixiJS 的互動式對齊和 FSM 狀態機調校。

> 專案內附的生圖是已知失敗案例，只供 pipeline 與 editor 功能測試，不可當作視覺品質基準；deterministic file checks 通過也不代表 visual QA 通過。

---

## 核心功能

1. **AI 輔助動態影格生成**：由 MCP 連接的 image-capable agent 依參考姿勢逐幀產生 PNG。
2. **自動 QA 驗證器**：檢驗圖片完整性、尺寸、alpha 覆蓋率以及 LLM 視覺一致性。
3. **高效合圖打包器**：將獨立影格打包為 spritesheet，搭配 `atlas.json` 設定檔，自動輸出 WebP 壓縮版本。
4. **互動式 PixiJS Web 編輯器**：
   - **可視化時間軸**：支援單影格自訂播放時長，即時預覽。
   - **錨點微調**：拖曳與鍵盤方向鍵微調 anchor。
   - **畫布平移與縮放**：滾輪縮放、右鍵拖曳畫布。
   - **綠幕去背（Chroma Key）**：即時綠幕去背預覽與容差調節。
   - **Sprite runtime**：以 `aispritejs` 驅動 input-based 視覺狀態與 deterministic frame timing，舊版 event-based atlas 則保留 `aifsmjs` 相容路徑。
   - **本地直寫存檔**：一鍵存檔，同步儲存 atlas.json 與去背透明 PNG。
   - **Host Bridge**：以 `aibridgejs` 向嵌入頁面提供受限 iframe 指令與唯讀 editor context；產圖提交仍只能走本機 MCP。

CLI pack 設有品質 gate：`qa-report.json` 必須同時具備 `overall: "pass"` 與 `visual_qa.status: "pass"`。僅通過 deterministic checks 或使用 `--skip-vision`，都不能視為生圖已核准。

---

## 快速開始

### 1. 環境準備與 AI 助理設定

產生美術內容時，需要具備生圖能力並支援本機 MCP 或 manual handoff 的 AI 助理；預覽、deterministic QA 與 packing 不需要模型 API key。

您只需在工作區中與您的 AI 助理開啟新對話，並發送**第一個啟動提示詞**（見下方的 [AI 助理協同指南](#ai-助理協同指南適用於新-session)）。

AI 助理會自動閱讀 [SKILL.md](./SKILL.md) 並在您的電腦上自動完成以下第一次安裝：
* **Node.js 22.12+**，供本機 editor server 與 MCP bridge 使用
* **Python 虛擬環境**與依賴套件（`requirements.txt`），供影像 QA 與 packing 使用
* 用於圖片處理與壓縮的 **Homebrew 套件**（`webp`、`oxipng`、`optipng`）

*（若您需要手動安裝步驟，請參閱 [SKILL.md](./SKILL.md) 檔案中的命令。）*

### 2. 快速預覽現有範例（無需重複生成）

本專案隨附已知失敗的圖片 fixtures（例如 `reimu`、`sakuya`、`chest`、`fireball`），僅用於測試 pipeline 與 editor，不是已核准的美術資產。您可以啟動 Web 編輯器檢查這些案例：

```bash
# 啟動僅限本機的後端伺服器
npm ci
npm run serve
```
伺服器預設只綁定 `127.0.0.1`。若確實需要 LAN 測試，可設定 `AISPRITE_STUDIO_HOST=0.0.0.0`；開發伺服器沒有驗證機制，請勿暴露在不受信任的網路。

在瀏覽器中開啟 `http://localhost:8080/?char=reimu`。您可以拖曳時間軸、微調錨點（Pivot）或調整綠幕去背參數。

---

### 3. 自訂 Sprite 製作工作流（AI 協作）

若要利用本專案的 AI 協作工具鏈，為您自己客製化的人物或物品製作雪碧圖合圖，請遵循以下步驟：

#### 步驟 A：準備資產資料夾
1. 在 `assets/` 目錄下建立子目錄（例如 `assets/my_hero`）。
2. 新增 `assets/my_hero/request.yml` 指定您要的動畫動作（格式見下方範例）。
3. 放入原初參考圖 `assets/my_hero/tpose.png`（需為乾淨的正面站立姿勢、綠幕背景）。

#### 步驟 B：生成生圖計畫 (Generation Plan)
在本地終端機執行 generate 指令：
```bash
python3 -m tools.sprite_pipeline.cli generate assets/my_hero
```
腳本將分析您的 `request.yml`，並在終端機印出給 AI 助理專用的**生圖計畫文字**。

#### 步驟 C：交給 image-capable agent
連接本機 MCP server，呼叫 `aisprite_studio_get_generation_task`，使用所有回傳的 PNG references 產生指定影格，再透過 `aisprite_studio_submit_generated_frame` 驗證並提交。沒有 MCP 的 host 可使用 editor 的 **Copy active frame task**，產圖後交由已連線的 MCP agent 提交。

#### 步驟 D：QA 檢驗與打包合圖
當助理回報生圖完成後，執行品質檢驗與合圖編譯：
```bash
# 驗證圖片尺寸、去背透明度等
python3 -m tools.sprite_pipeline.cli qa assets/my_hero --skip-vision

# 打包原始影格為單張 spritesheet 與 atlas.json 檔案
python3 -m tools.sprite_pipeline.cli pack assets/my_hero
```

在瀏覽器中開啟 `http://localhost:8080/?char=my_hero` 即可預覽並微調您全新的客製化合圖！

---

## AI 助理協同指南（適用於新 Session）

> [!IMPORTANT]
> **平台支援**：目前本專案僅在 **macOS** 系統上進行過實行與驗證。

當您在工作區中開啟 Codex、Claude、Gemini、Antigravity 或其他 coding agent 的新 Session 時，可使用以下提示詞進入相同工作流。

### 1. 新 Session 啟動提示詞
開啟新對話時，直接複製並發送以下提示詞，引導 AI 助理快速進入狀況：
```
我們正在開發 AI Sprite Studio。請先閱讀 SKILL.md 與 AGENTS.md，再執行 SKILL.md 的環境診斷；安裝系統套件前先回報缺少項目。所有 checked-in 生圖都視為失敗且未核准，請使用本機 aisprite-studio MCP 進行 reference 修復、取得精確 frame task、驗證 PNG 提交與 deterministic QA；visual approval 仍需獨立人工確認。
```

### 2. 後續常用協作提示詞（非常適合美術或非開發人員）
美術人員或不熟悉終端機指令的成員，可以直接將以下口語提示詞發送給 AI 助理，讓助理在背景自動執行對應的工作：

* **啟動編輯器伺服器**：
  ```
  請用 `npm run serve` 啟動本機 Web 編輯器伺服器。啟動成功後，請直接提供 localhost 開啟連結給我。
  ```
* **開始進行 AI 影格生圖**：
  ```
  我已經在 "assets/my_char/" 目錄下放置了 request.yml 以及 tpose.png。請先幫我分析並產出生圖計畫，然後開始依序繪製所有剩餘的影格。
  ```
* **打包雪碧圖合圖**：
  ```
  生成的影格看起來沒問題了，請幫我執行 QA 品質檢驗並打包成合圖（pack）。打包完成後，請告訴我該如何重新載入並在編輯器中預覽。
  ```

---

## 目錄結構

```
├── assets/                  # 遊戲資產
│   ├── chest/               # 3D 卡通寶箱 (open → shine FSM)
│   ├── flame/               # 火焰特效 (burn loop)
│   ├── reimu/               # 靈夢角色 (idle, walk, attack)
│   └── sakuya/              # 咲夜角色 (idle)
│       ├── frames/          # 原始 PNG 影格
│       ├── output/          # 合圖、atlas.json、WebP
│       ├── input.png        # 使用者原始參考圖
│       ├── tpose.png        # T-Pose / 原初參考圖
│       └── request.yml      # 動畫規格設定
├── webeditor/               # Web 編輯器
│   ├── index.html           # 編輯器首頁
│   ├── style.css            # 編輯器樣式 (已抽出)
│   ├── src/                 # JS 模組
│   │   ├── editor.js        # 主控制器
│   │   ├── preview.js       # PixiJS 畫布、縮放
│   │   ├── runtime.js       # aispritejs runtime + 舊版 aifsmjs 相容層
│   │   ├── fsm.js           # 舊版 aifsmjs 狀態機綁定
│   │   ├── prompt-builder.js # 再生成提示詞合成
│   │   └── ...              # bus, timeline, keyboard, chroma 等
│   └── vendor/              # Vendored 依賴 (PixiJS, ai*js)
├── tools/sprite_pipeline/   # Python 影像核心（QA + Packer）
├── prompts/                 # Agent 提示詞範本
├── schemas/                 # JSON schema (atlas.schema.json)
├── docs/                    # 文件與測試清單
├── server.mjs              # Node.js 後端 HTTP 伺服器
├── AGENTS.md                # Agent pipeline 規格
└── SKILL.md                 # Agent session 啟動指引
```

---

## Vendor 依賴

`webeditor/vendor/` 保存已鎖版的 `islumina/*` ESM snapshot，讓 editor 不需 build step 即可執行。更新相鄰的 ai*js repos 並完成 build 後，執行 `npm run vendor:update`。本機套件版本必須與 root `package.json` 的精確版本一致；只有刻意升版時才使用 `--allow-version-mismatch`。

## AI agent 接入（MCP）

可選的 [`mcp-server`](./mcp-server/) 讓支援 MCP 的 AI client 參與 editor 流程，瀏覽器不需要保存模型 API key。它透過本機 stdio 提供 asset 清單、reference 修復、精確 frame prompt、PNG references、受驗證的圖片提交與 deterministic QA。既有生圖會明確視為失敗且尚未核准。執行 `cd mcp-server && npm install && npm run check`，再從 editor 的 **AI Agent Handoff** 卡片複製 client config。

官網 Playground 維持 read-only。寫入只在本機進行，而且限制於 request.yml 已宣告的 `assets/{asset}/frames/{frame}.png`；deterministic QA 仍不等於 visual approval。

---

## Sprite 狀態配置範例

新 atlas 採用 `aispritejs` input-driven graph。非循環狀態可透過 `onEnd` 回到另一個狀態：

```json
"states": {
  "open": { "animation": "open_front", "loop": false, "onEnd": "shine" },
  "shine": { "animation": "shine_front", "loop": true }
},
"inputs": {},
"transitions": [],
"initial": "open"
```

**運作效果**：`aispritejs` 播放一次 `open_front`，結束後 deterministic 地切換至 `shine` 並循環播放。

---

## 智慧財產權與授權條款

### 東方 Project 版權聲明
本專案 `assets/` 目錄中包含的多數角色範例（例如 `reimu`、`sakuya`）均源自於**東方 Project**（東方Project）。這些角色的智慧財產權與版權均屬於 **上海愛麗絲幻樂團**（上海アリス幻樂団）與 **ZUN**。此處僅作為非商業性開發範例展示之用。

### 授權條款
本專案採用 MIT 授權條款，詳見 [LICENSE](./LICENSE) 檔案。

作者：ysl
