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
python3 -c "import PIL, numpy, yaml, jsonschema" 2>/dev/null && echo "✓ Python packages OK" || echo "✗ Missing packages"
```

* **安裝指引**：若缺少 Python 套件：
  ```bash
  pip install -r requirements.txt
  ```

### B. 檢查 WebP 工具（可選）

`cwebp` 把合圖壓成 WebP，`packer.py` 會自動偵測並使用；沒有安裝時輸出 PNG。

```bash
which cwebp
```

* **安裝指引 (macOS)**：
  ```bash
  brew install webp
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
可手動測試或使用可用的 browser automation 進行驗證。

---

## 2. Sprite Pipeline 操作指南

### A. 執行 QA 驗證
```bash
python3 -m tools.sprite_pipeline.cli qa assets/{character_name} --skip-vision
```
- 逐格檢查：PNG 格式（改副檔名的 JPEG 會報實際格式）、尺寸、背景能否去背、覆蓋率、重心偏移。
- 逐動畫檢查：重複影格與沒有動作、比例漂移、色彩漂移、主體貼邊。
- 輸出每個動畫 0–100 分與修復提示；終端機印出最低分與前幾條提示，完整內容在 `qa-report.json` 的 `animations` 與各影格的 `repair_hint`。
- 分數只代表 deterministic checks，100 分也不是視覺核准。

### B. 記錄視覺審查
人（或具備視覺能力的 agent）看過影格後，在 `qa-report.json` 寫入 `"visual_qa": {"status": "pass"}`。重新執行 QA 會覆寫報告，所以審查要放在最後。

### C. 執行 Packer 合圖
```bash
python3 -m tools.sprite_pipeline.cli pack assets/{character_name}
# → 去背、trim、shelf packing，輸出 {name}.webp（沒有 cwebp 時為 .png）與 atlas.json
# → 保留 atlas.json 中在 editor 調好的 anchor、duration 與 state graph；加 --fresh 則全部重算
```

Packer 只接受 `qa-report.json` 同時滿足 `overall: pass` 與 `visual_qa.status: pass`。`--skip-vision` 只代表 deterministic checks 完成，不能視為視覺核准。

---

## 3. Web 編輯器存檔工作流

1. **載入資產**：於左側選擇 asset，自動載入 `assets/{char}/output/atlas.json`。
2. **微調**：調整 `duration`（影格播放時間）、`anchor`（對齊錨點）等參數。
3. **儲存至本機**：點擊 `Save to local disk`，`server.mjs` 以原子寫入更新 `atlas.json`。合圖本身不透明、由 editor 去背時，另外寫出 `{char}_keyed.png`（有 `cwebp` 時再加 `.webp`）。

---

## 4. 起始對話與資產初始化 SOP

當開啟新 session，使用者提供圖片或描述要求製作新資產時：

### 步驟 1：執行工具與環境診斷
在回覆使用者前，優先執行 **第 1 節** 的診斷指令，確保環境就緒。

### 步驟 2：建立原初參考圖 (T-Pose / Reference Image)
1. 建立目錄 `assets/{name}/`。
2. 依資產類型產生參考圖：
   - **人物角色**：呼叫 `aisprite_studio_get_reference_task`，透過 image-capable host 產生單一純色背景（綠色 `#00FF00`；主體偏綠時用藍色 `#0000FF`）的 `tpose.png`，再由 `aisprite_studio_submit_reference` 驗證並提交。
   - **非人物資產（物品/特效）**：若使用者有附圖，儲存為 `tpose.png`（或 `input.png`）；若無附圖，依描述產生靜態原初圖片存為 `tpose.png`。

### 步驟 3：撰寫資產規格 (`request.yml`)
```yaml
character: chest
style: 3d cartoon game style
frame_size: 1024
asset_type: object        # character | object | effect，預設 character
animations:
  - action: open
    direction: front      # 可選；沒有朝向的主體留空
    frames: 6
    fps: 10               # 可選，預設 8
  - action: shine
    direction: front
    frames: 4
```

### 步驟 4：依動作描述進行影格生成
- **Row task（優先）**：呼叫 `aisprite_studio_get_row_task`，用回傳的參考圖與有編號的 layout guide，把整個動畫畫在一張圖上，再以 `aisprite_studio_submit_generated_row` 提交。pipeline 會依內容切出影格，數量不符時整批拒收並說明找到幾個。若回傳的 `warning` 指出姿勢需要放大超過 1.25 倍，改用 frame task。
- **Frame task**：呼叫 `aisprite_studio_get_generation_task` 取得精確 prompt 與 PNG references，產圖後以 `aisprite_studio_submit_generated_frame` 驗證尺寸、檔名與 PNG 並原子寫入。
- **必須使用 host 的圖片編輯模式**並傳入所有回傳的 references，不可改用純文字生圖。
- 強調維持背景/物品主體靜止，僅對變動部分（光效、火焰等）微調。

### 步驟 5：驗證、審查與打包
```bash
python3 -m tools.sprite_pipeline.cli qa assets/{name} --skip-vision
```
依修復提示重新生成被點名的影格，直到 QA 通過；接著依第 2B 節記錄視覺審查，最後執行：
```bash
python3 -m tools.sprite_pipeline.cli pack assets/{name}
```
