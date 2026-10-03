# Smoke Test Checklist

每次更動後照表測試，確保沒有 regression。可手動或用 browser automation 執行。

## 前置

```bash
cd /absolute/path/to/aisprite-studio
npm ci
npm test              # server、webeditor、MCP、Python、parity 全部測試
npm run vendor:check  # vendored 檔案與 node_modules 逐 byte 一致
npm run serve &
# → 等待 "Dev server on http://127.0.0.1:8080 (no-cache)"
```

## 測試項目

### 1. 頁面載入
- [ ] `http://localhost:8080` 回應 200
- [ ] 頁面為深色主題、紫色 accent
- [ ] Header 顯示 `AI SPRITE STUDIO` 與 `aispritejs · aieventjs · aibridgejs` badge
- [ ] 預設 asset 自動載入（select 非空）

### 2. 資產切換：每個都切一次
| Asset | 預期 badge | 初始狀態 | Canvas |
|-------|-----------|---------|--------|
| chest | `Object / Icon` | `open_front` | 寶箱開啟動畫 |
| clownfish | `Character` | `swim` | 小丑魚游動（無 direction 的命名） |
| fireball | `Effect` | `idle_loop` | 火球循環 |
| reimu | `Character` | `idle` | 靈夢待機；按住 D 切到 `walk` |
| sakuya | `Character` | `idle_front` | 咲夜待機 |

### 3. 左側面板
- [ ] 有 `input.png` 的 asset（sakuya）顯示 Reference Pose；沒有的顯示 placeholder，且不發出 404
- [ ] T-Pose Grid 顯示 `tpose.png`，背景已依邊框色去背（reimu 為藍幕）
- [ ] T-Pose 的 Generation Prompt 顯示 MCP reference task
- [ ] State 下拉選單列出所有狀態

### 4. Prompt 面板
- [ ] Animation Prompt 顯示 `Animation '<name>' of <asset>: N frames …`
- [ ] 展開 Frame Prompt，顯示 `Generate <frame>.png … Pose: …`，與 MCP `aisprite_studio_get_generation_task` 的 prompt 相同
- [ ] Regenerate 與 Copy active frame task 複製同一份 task

### 5. Frame Inspector（底部 bar）
- [ ] ⏮⏸⏭ 按鈕可操作，暫停後可逐幀前進 / 後退
- [ ] Timeline 卡片與當前幀同步 highlight
- [ ] Duration 輸入框可修改（改值後動畫速度即時變化）

### 6. 播放控制
- [ ] Preview lock 開著時，選取的 state 循環播放
- [ ] Lock 開著時按 Space：trigger 播一次，依 graph 回到原狀態，不會卡在 trigger state
- [ ] 鍵盤卡片只顯示 graph 有宣告的 input

### 7. JSON Editor（右側）
- [ ] Atlas JSON 正確顯示，meta 含 `frameTags`
- [ ] 手動修改 anchor → Apply → canvas anchor 跟著動
- [ ] 輸入非法 JSON → 邊框變紅 (json-invalid)

### 8. 匯出與存檔
- [ ] Export JSON → 下載 `.json` 檔
- [ ] Export keyed PNG → 依邊框色去背；已有 alpha 的合圖原樣輸出
- [ ] Save to local disk → 顯示 `✓ Saved to disk`

### 9. Console 與網路
- [ ] 沒有 JS runtime error
- [ ] 載入任一 asset 時沒有任何 4xx 請求

### 10. API 驗證
```bash
# 應回 200 + JSON
curl -s http://localhost:8080/api/assets | python3 -m json.tool | head -5
curl -s "http://localhost:8080/api/frame-task?char=reimu&frame=idle_front_01" | python3 -m json.tool | head -5

# 路徑穿越應被擋 → 404
curl -s -o /dev/null -w "%{http_code}\n" --path-as-is http://localhost:8080/assets/../server.mjs

# 不是 loopback 名稱或 IP 的 Host 應被擋 → 403
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: attacker.example" http://localhost:8080/api/assets

# 跨站寫入應被擋 → 415 與 403
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: text/plain" -d '{}' http://localhost:8080/api/save
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" -H "Origin: https://evil.example" -d '{}' http://localhost:8080/api/save
```

### 11. 窄螢幕
- [ ] 375 px 寬時進入 viewer 模式，沒有水平捲動

## 清理

```bash
kill %1  # 關閉 server.mjs
```
