# Smoke Test Checklist

每次更動後照表測試，確保沒有 regression。可手動或用 MCP 自動化。

## 前置

```bash
cd /Volumes/MiniBackup/sys/aiplaybook
node --check server.mjs
node --check tools/vendor-update.mjs
npm run test:server
npm run vendor:check
python3 -c "import py_compile; py_compile.compile('tools/sprite_pipeline/packer.py', doraise=True); print('packer.py OK')"
npm run serve &
# → 等待 "Dev server on http://localhost:8080"
```

## 測試項目

### 1. 頁面載入
- [ ] `http://localhost:8080` 回應 200
- [ ] `style.css` 外連載入（頁面有深色主題、紫色 accent）
- [ ] Header 顯示 `AI SPRITE STUDIO` 與 `aispritejs · aifsmjs · aipooljs · aieventjs · aibridgejs` badge
- [ ] 預設角色自動載入（select 非空）

### 2. 資產切換 — 每個都切一次
| Asset | 預期 badge | 預期狀態 | Canvas 有動畫 |
|-------|-----------|---------|-------------|
| chest | `Object / Icon` | `open_front` | ✓ 寶箱開啟 |
| reimu | `Character` | `attack_front` | ✓ 靈夢攻擊 |
| flame | `Object / Icon` | `burn_loop` | ✓ 火焰循環 |
| sakuya | `Character` | `idle_front` | ✓ 咲夜待機 |

### 3. 左側面板
- [ ] Reference Pose 圖片正確顯示（input.png）
- [ ] T-Pose Grid 圖片正確顯示（tpose.png）
- [ ] Animation 下拉選單列出所有動作

### 4. Frame Inspector (底部 bar)
- [ ] ⏮⏸⏭ 按鈕可操作
- [ ] 暫停後可逐幀前進 / 後退
- [ ] Timeline 卡片與當前幀同步 highlight
- [ ] Duration 輸入框可修改（改值後動畫速度即時變化）

### 5. JSON Editor (右側)
- [ ] Atlas JSON 正確顯示
- [ ] 手動修改 anchor → Apply → canvas anchor 跟著動
- [ ] 輸入非法 JSON → 邊框變紅 (json-invalid)

### 6. 匯出功能
- [ ] Export JSON → 下載 `.json` 檔
- [ ] Export keyed PNG → 下載去綠幕的 PNG
- [ ] Save to local disk → 顯示 `✓ Saved to disk`

### 7. Console 檢查
- [ ] 無 JS runtime error（`list_console_messages types=["error"]`）
- [ ] Optional 的 `spec.json`、`prompts/tpose.txt` 不存在時仍無 runtime error

### 8. API 驗證
```bash
# 應回 200 + JSON
curl -s http://localhost:8080/api/assets | python3 -m json.tool | head -5

# 路徑穿越應被擋
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/assets/../server.mjs
# → 應回 404
```

## MCP 自動化版

用以下 MCP 指令序列驗證：

```
1. navigate_page → http://localhost:8080
2. take_screenshot → 確認首畫面
3. list_console_messages types=["error"] → 確認無 JS error
4. fill uid=<select> value="reimu" → 切換角色
5. wait_for text=["reimu"] → 等待載入
6. take_screenshot → 確認 reimu 畫面
7. 重複 4-6 對 flame, sakuya, chest
```

## 清理

```bash
kill %1  # 關閉 server.mjs
```
