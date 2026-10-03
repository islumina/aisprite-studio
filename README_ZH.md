# AI Sprite Studio — 互動式 Sprite 編輯器與合圖打包工具

> [!NOTE]
> 本專案是實驗性 hobby project，本機 MCP handoff 支援 Codex、Claude、Gemini、Antigravity 與其他具備生圖能力的 agent。

AI Sprite Studio 是一個專為遊戲美術資產設計的開發平台，支援 AI 動態影格生成、自動 QA 驗證、合圖編譯，以及基於 PixiJS 的互動式對齊和 state graph 調校。

> 專案內附的生圖是已知失敗案例，只供 pipeline 與 editor 功能測試，不可當作視覺品質基準；deterministic checks 通過也不代表 visual QA 通過。

---

## 核心功能

1. **AI 輔助動態影格生成**：透過 MCP 連接的 image-capable agent 產圖。repo 不保存任何模型 API key，由 host 負責生圖。
   - **Row task**：agent 在一張圖裡畫完整個動畫的所有姿勢，搭配有編號的 layout guide。並排繪製能讓角色樣貌、比例與色盤更一致。pipeline 依內容找出姿勢，數量與宣告不符就拒收，並以同一個縮放比例放進每一格。
   - **Frame task**：一次一格，附上參考圖、frame 0 與前一格。`frame_size` 較大時比較適合，因為 row 模式需要放大每個姿勢。
2. **去背（Chroma Key）**：每一格的背景色都從該格自己的邊框量測（生圖模型很少畫出精確色碼），去除後再把邊緣像素與疊在綠幕上的光暈從背景色中還原出來，邊緣保有原本的顏色。背景若不是單一、飽和的純色，就直接拒絕，不會猜。
3. **Deterministic QA、分數與修復提示**：逐格檢查檔案格式、尺寸、能否去背、覆蓋率與重心偏移；逐動畫檢查重複影格、沒有動作、比例漂移、色彩漂移與貼邊裁切。每個動畫有 0–100 分與可直接交給生圖 agent 的修復提示。visual approval 仍是獨立的關卡。
4. **合圖打包器**：去背後的影格先 trim，完全相同的影格共用同一塊 rect，再以 shelf packing 加上間距打包成 WebP 合圖。`atlas.json` 可直接給 PixiJS 讀取，也因為帶有 Aseprite `frameTags`，可以用 Phaser 的 `load.aseprite` 載入。重新打包時會保留在 editor 調好的 anchor、duration 與 state graph。
5. **互動式 PixiJS Web 編輯器**：
   - **可視化時間軸**：支援單影格自訂播放時長，即時預覽。
   - **錨點微調**：拖曳與鍵盤方向鍵微調 anchor，支援 onion skin。
   - **畫布平移與縮放**：滾輪縮放、右鍵拖曳畫布，高 DPI 螢幕也清晰。
   - **GPU 去背**：用每張圖自己的邊框色去背不透明的合圖與 T-Pose；已有 alpha 的合圖不處理。
   - **Sprite runtime**：以 `aispritejs` 驅動 atlas 的 state graph 與 deterministic frame timing。graph 宣告的數值 input 對應 WASD，第一個 trigger 對應 Space。
   - **Prompt 面板**：顯示 MCP server 會交給 agent 的完整 task，對應目前選取的動畫或影格。
   - **本地直寫存檔**：`POST /api/save` 寫入 atlas JSON，並可選擇輸出去背 PNG。
   - **Host Bridge**：以 `aibridgejs` 向嵌入頁面提供受限 iframe 指令與唯讀 editor context；產圖提交仍只能走本機 MCP。
   - **Viewer 模式**：寬度 900 px 以下時切換為唯讀播放器。

CLI pack 設有品質 gate：`qa-report.json` 必須同時具備 `overall: "pass"` 與 `visual_qa.status: "pass"`。僅通過 deterministic checks 或使用 `--skip-vision`，都不能視為生圖已核准。

---

## 快速開始

### 1. 環境準備與 AI 助理設定

產生美術內容時，需要具備生圖能力並支援本機 MCP 或 manual handoff 的 AI 助理；預覽、deterministic QA 與 packing 不需要模型 API key。

在工作區中與 AI 助理開啟新對話，並發送**第一個啟動提示詞**（見下方 [AI 助理協同指南](#ai-助理協同指南適用於新-session)）。助理會閱讀 [SKILL.md](./SKILL.md) 並完成以下安裝：
* **Node.js 22.12+**，供本機 editor server 與 MCP bridge 使用
* **Python 3.10+** 與 `requirements.txt`（Pillow、NumPy、PyYAML、jsonschema），供去背、QA 與 packing 使用
* **`cwebp`**（Homebrew `webp`，可選），用於輸出 WebP 合圖

*（若需要手動安裝步驟，請參閱 [SKILL.md](./SKILL.md) 中的命令。）*

### 2. 快速預覽現有範例（無需重新生成）

本專案隨附已知失敗的 fixtures（`chest`、`clownfish`、`fireball`、`reimu`、`sakuya`），只用於測試 pipeline 與 editor，不是已核准的美術資產。

```bash
npm ci
npm run serve
```

伺服器預設只綁定 `127.0.0.1`。若確實需要 LAN 測試，請設定 `AISPRITE_STUDIO_HOST=0.0.0.0`，並以 IP 位址加上 `?mode=local` 開啟（例如 `http://192.168.1.20:8080/?mode=local`）。伺服器只接受 loopback 名稱與 IP 位址作為 Host，而且沒有驗證機制，請勿暴露在不受信任的網路。

在瀏覽器中開啟 `http://localhost:8080/?char=reimu`，可以拖曳時間軸、微調錨點（Pivot）或調整去背參數。

---

### 3. 自訂 Sprite 製作工作流（AI 協作）

#### 步驟 A：準備資產資料夾
1. 建立 `assets/my_hero/`。
2. 新增 `assets/my_hero/request.yml`（格式見下方）。
3. 放入原初參考圖 `assets/my_hero/tpose.png`：乾淨的正面中性姿勢，背景為單一純色（綠色；主體偏綠時用藍色）。MCP 的 reference task 可以產生或修復它。

#### 步驟 B：交給 image-capable agent 生成影格
連接本機 MCP server 後，二選一：
- **Row**：呼叫 `aisprite_studio_get_row_task`，用回傳的參考圖與 layout guide 把整個動畫畫在一張圖上，再以 `aisprite_studio_submit_generated_row` 提交。
- **Frame**：呼叫 `aisprite_studio_get_generation_task`，用所有回傳的參考圖產生該影格，再以 `aisprite_studio_submit_generated_frame` 提交。

若姿勢需要放大超過 1.25 倍才能達到 `frame_size`，row task 會發出警告，這時請改用 frame task。沒有 MCP 的 host 可以用 `npm run plan -- assets/my_hero` 印出所有待生成的 frame task，或使用 editor 的 **Copy active frame task**，產圖後交給已連線 MCP 的 agent 提交。

#### 步驟 C：QA 與修復
```bash
python3 -m tools.sprite_pipeline.cli qa assets/my_hero --skip-vision
```
QA 會印出最低的動畫分數與修復提示；`qa-report.json` 記錄所有檢查項目、每個失敗影格的 `repair_hint`，以及每個動畫的 `score`、`issues`、`hints`。重新生成提示中點名的影格，再跑一次 QA。

#### 步驟 D：視覺審查與打包
由人（或具備視覺能力的 agent）審查影格後，在 `qa-report.json` 記錄 `"visual_qa": {"status": "pass"}`。重新執行 QA 會覆寫報告，所以審查要放在最後。接著：
```bash
python3 -m tools.sprite_pipeline.cli pack assets/my_hero
```
`pack --fresh` 會忽略既有 `atlas.json` 中儲存的 anchor、duration 與 state。

在瀏覽器中開啟 `http://localhost:8080/?char=my_hero` 即可預覽並微調合圖。

### request.yml 格式

```yaml
character: chest           # 資產識別名稱
style: 3d cartoon game     # 美術風格描述
frame_size: 1024           # px，正方形
asset_type: object         # character | object | effect（預設 character）

animations:
  - action: open
    direction: front       # 可選；沒有朝向的主體留空（影格名稱變成 open_00 ...）
    frames: 6
    fps: 10                # 可選；預設 8
  - action: shine
    direction: front
    frames: 4
```

影格命名為 `{action}_{direction}_{index:02d}.png`；沒有 direction 時為 `{action}_{index:02d}.png`。

---

## AI 助理協同指南（適用於新 Session）

> [!IMPORTANT]
> **平台支援**：目前本專案僅在 **macOS** 上驗證過。

在工作區中開啟 Codex、Claude、Gemini、Antigravity 或其他 coding agent 的新 Session 時，可使用以下提示詞進入相同工作流。

### 1. 新 Session 啟動提示詞
```
我們正在開發 AI Sprite Studio。請先閱讀 SKILL.md 與 AGENTS.md，再執行 SKILL.md 的環境診斷；安裝系統套件前先回報缺少項目。所有 checked-in 生圖都視為失敗且未核准，請使用本機 aisprite-studio MCP 進行 reference 修復、row 或 frame task、驗證 PNG 提交與 deterministic QA；visual approval 仍需獨立人工確認。
```

### 2. 後續常用協作提示詞（適合美術或非開發人員）

* **啟動編輯器伺服器**：
  ```
  請用 `npm run serve` 啟動本機 Web 編輯器伺服器。啟動成功後，請直接提供 localhost 開啟連結給我。
  ```
* **開始進行 AI 影格生圖**：
  ```
  我已經在 "assets/my_char/" 目錄下放置了 request.yml 以及 tpose.png。請透過 aisprite-studio MCP server 生成各個動畫，每完成一個就跑 QA，並修復 QA 指出的問題。
  ```
* **打包雪碧圖合圖**：
  ```
  我已經看過影格，沒有問題。請在 qa-report.json 記錄視覺核准並打包合圖。打包完成後，請告訴我如何在編輯器中重新載入並預覽。
  ```

---

## 目錄結構

```
├── assets/                  # 已知失敗的 fixtures：chest、clownfish、fireball、reimu、sakuya
│   └── <asset>/
│       ├── request.yml      # 動畫規格設定
│       ├── tpose.png        # 原初參考圖
│       ├── input.png        # 可選的使用者原始參考圖
│       ├── frames/          # 影格 PNG，每個宣告的影格一張
│       ├── raw/             # Row task 的圖（raw/<animation>.png）與切幀報告
│       ├── output/          # atlas.json + 合圖 .webp（打包的 .png 不進 git）
│       └── qa-report.json
├── webeditor/               # Web 編輯器（純 ES modules，不需 build）
│   ├── index.html
│   ├── style.css
│   ├── src/
│   │   ├── editor.js        # 主控制器
│   │   ├── preview.js       # PixiJS 畫布與播放
│   │   ├── runtime.js       # 驅動 atlas state graph 的 aispritejs animator
│   │   ├── chroma-filter.js # GPU 去背
│   │   ├── prompts.js       # Prompt 面板（MCP task、static demo prompt）
│   │   └── ...              # agent-handoff、pose-panels、viewport、timeline、keyboard、bus、constants
│   └── vendor/              # Vendored PixiJS 與 ai*js
├── tools/sprite_pipeline/   # Python：chroma、qa、qa_sequence、row、packer、spec、cli
├── mcp-server/              # MCP server（TypeScript；dist/ 會 commit）
├── prompts/                 # Agent system prompts
├── schemas/                 # atlas.schema.json
├── docs/                    # Smoke test 清單
├── server.mjs               # 本機 editor server 與 API
├── AGENTS.md                # Agent pipeline 規格
└── SKILL.md                 # Agent session 啟動指引
```

---

## Vendor 依賴

`webeditor/vendor/` 保存已鎖版的 PixiJS 與 `islumina/*` ESM 副本，讓 editor 不需 build step 即可執行。檔案從 `node_modules` 依 `package.json` 的精確版本複製：先執行 `npm ci`，再執行 `npm run vendor:update`。`npm run vendor:check`（CI 也會跑）會逐 byte 比對 vendored 檔案與更新後應有的內容，不一致就失敗。若要 vendor 尚未發佈的版本，先安裝它，例如 `npm install --no-save ../aispritejs`。

## AI agent 接入（MCP）

[`mcp-server`](./mcp-server/) 讓支援 MCP 的 AI client 參與工作流程，瀏覽器不需要保存模型 API key。它透過本機 stdio 提供 asset 清單、reference 修復、附 PNG references 的 row 與 frame task、受驗證的圖片提交，以及附分數摘要的 deterministic QA。既有生圖會明確視為失敗且尚未核准。在 repo 根目錄執行 `npm ci && npm run test:mcp`，再從 editor 的 **AI Agent Handoff** 卡片複製 client config。

官網 Playground 維持 read-only。寫入只在本機進行，而且限制於 request.yml 已宣告的 `assets/{asset}/frames/{frame}.png` 與 `assets/{asset}/raw/{animation}.png`；deterministic QA 仍不等於 visual approval。

---

## Sprite 狀態配置範例

atlas 採用 `aispritejs` input-driven graph。非循環狀態可透過 `onEnd` 回到另一個狀態：

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

## 致謝

搭配 layout guide 的 row 生成、逐格量測背景色並還原邊緣的去背方式，以及附修復提示的動畫序列 QA，參考了 [aldegad/sprite-gen](https://github.com/aldegad/sprite-gen)（Apache-2.0）的做法。本專案自行重新實作，不包含其程式碼。

## 智慧財產權與授權條款

### 東方 Project 版權聲明
本專案 `assets/` 目錄中的多數角色範例（例如 `reimu`、`sakuya`）源自**東方 Project**（東方Project）。這些角色的智慧財產權與版權屬於 **上海愛麗絲幻樂團**（上海アリス幻樂団）與 **ZUN**，此處僅作為非商業性開發範例。

### 授權條款
本專案採用 MIT 授權條款，詳見 [LICENSE](./LICENSE)。

作者：ysl
