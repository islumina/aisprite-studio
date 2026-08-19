# AI Sprite Studio — Agent Operation & Diagnostics Guide

本文件為 AI Agent 在本 session 開始或接手本專案時的診斷與操作指引。請於啟動時優先執行本指引中的各項檢查。

---

## 1. 啟動診斷與工具檢查清單

當新 session 開始時，依序執行以下命令，確認開發環境與必備工具就緒。

### A. 檢查 Node.js 與 Python 影像工具

```bash
# 1. 檢查 Node.js 版本（需要 22.12+）
node --version

# 2. 檢查 Python 版本（建議 3.10+）
python3 --version

# 3. 檢查虛擬環境是否存在且已啟動
which python3

# 4. 檢查 Python 影像套件依賴
python3 -c "import PIL, yaml, jsonschema, pydantic" 2>/dev/null && echo "✓ Python packages OK" || echo "✗ Missing packages"
```

* **安裝指引**：若缺少 Python 套件：
  ```bash
  pip install -r requirements.txt
  ```

### B. 檢查壓圖工具

專案使用三種壓圖工具（均為可選）：

| 工具 | 用途 | 使用時機 |
|------|------|----------|
| `cwebp` | PNG → WebP 有損壓縮 | `packer.py` 自動偵測並使用 |
| `optipng` | PNG 無損壓縮 | 手動對 spritesheet 壓縮 |
| `oxipng` | PNG 無損壓縮（多線程） | 手動對 spritesheet 壓縮 |

```bash
# 檢查是否已安裝
which cwebp optipng oxipng
```

* **安裝指引 (macOS)**：
  ```bash
  brew install webp optipng oxipng
  ```

### C. 檢查本地 Dev Server

```bash
# 檢查 8080 port 是否已被佔用
lsof -i :8080
```

* **啟動指引**：若未運行：
  ```bash
  npm run serve
  ```

### D. 執行 Smoke Test

每次變更後，參照 `docs/SMOKE_TEST.md` 執行快速驗證。
可手動測試或使用 Chrome DevTools MCP 自動化。

---

## 2. Sprite Pipeline 操作指南

### A. 執行 QA 驗證
```bash
python3 -m tools.sprite_pipeline.cli qa assets/{character_name} --skip-vision
```

### B. 執行 Packer 合圖
```bash
python3 -m tools.sprite_pipeline.cli pack assets/{character_name}
# → 自動產生 spritesheet + atlas.json
# → 若 PATH 上有 cwebp，自動輸出 .webp 壓縮版
```

Packer 只接受 `qa-report.json` 同時滿足 `overall: pass` 與 `visual_qa.status: pass`。`--skip-vision` 只代表 deterministic checks 完成，不能視為視覺核准。

### C. 額外壓縮（可選）
```bash
# PNG 無損壓縮
oxipng -o 4 assets/{character_name}/output/{character_name}.png
```

---

## 3. Web 編輯器存檔工作流

1. **載入資產**：於左側選擇 `character`，自動載入 `assets/{char}/output/atlas.json`。
2. **微調**：調整 `duration`（影格播放時間）、`anchor`（對齊錨點）等參數。
3. **儲存至本機**：點擊 `Save to local disk`：
   - 前端自動利用 Canvas 綠幕去背，生成透明 PNG。
   - 後台 `server.mjs` 以原子寫入方式更新 `atlas.json` 與 `{char}_keyed.png`。

---

## 4. 起始對話與資產初始化 SOP

當開啟新 session，使用者提供圖片或描述要求製作新資產時：

### 步驟 1：執行工具與環境診斷
在回覆使用者前，優先執行 **第 1 節** 的診斷指令，確保環境就緒。

### 步驟 2：建立原初參考圖 (T-Pose / Reference Image)
1. 建立目錄 `assets/{name}/`。
2. 依資產類型產生參考圖：
   - **人物角色**：呼叫 `generate_image` 產生去綠幕背景 (`#00FF00`) 的 `tpose.png`。
   - **非人物資產（物品/特效）**：若使用者有附圖，儲存為 `tpose.png`（或 `input.png`）；若無附圖，依描述產生靜態原初圖片存為 `tpose.png`。

### 步驟 3：撰寫資產規格 (`request.yml`)
```yaml
character: chest
style: 3d cartoon game style
frame_size: 1024
animations:
  - action: open
    direction: front
    frames: 6
  - action: shine
    direction: front
    frames: 4
```

### 步驟 4：依動作描述進行影格生成
- **必須使用 `generate_image` 的圖片編輯模式**。
- 傳入 `ImagePaths`（含 `tpose.png` 或前一影格 PNG），描述當前影格動作變化。
- 強調維持背景/物品主體靜止，僅對變動部分（光效、火焰等）微調。
- 將生成影格搬移至 `assets/{name}/frames/`。

### 步驟 5：驗證與打包
```bash
python3 -m tools.sprite_pipeline.cli qa assets/{name} --skip-vision
python3 -m tools.sprite_pipeline.cli pack assets/{name}
```
