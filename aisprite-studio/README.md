# aisprite-studio

[![npm version](https://img.shields.io/badge/npm-yshengliao-blue.svg)](https://www.npmjs.com/~yshengliao)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`aisprite-studio` 是一個專為 2D 網頁遊戲開發者打造的**精靈動畫圖集設計與打包可視化編輯器 (Interactive 2D Sprite Studio & Editor)**。

它允許開發者透過直覺的網頁介面，微調精靈圖的播放速率、設定 Anchor（錨點），並且能像 **Rive** 一樣，透過宣告式的**輸入變數條件（Inputs & Rules）**來動態驅動精靈動畫狀態，並在瀏覽器端即時完成去背與圖集打包。

本專案是 [`yshengliao`](https://www.npmjs.com/~yshengliao) 輕量級網頁遊戲開發周邊生態系的核心工具。

---

## 🚀 核心功能 (Key Features)

- **Rive-like 狀態機編輯 (Interactive State Machine)**：直覺地為動作（如 `idle`、`walk`、`jump`）配置觸發條件。支援 `Number`、`Boolean` 與 `Trigger` 三種輸入類型，遊戲程式碼只需更新物理狀態，動畫便會自動轉移。
- **純前端去背與打包 (Client-Side Chroma-Key & Packing)**：100% 執行於瀏覽器記憶體中，自動移除綠幕/藍幕背景並拼貼成 POT (Power of Two) 精靈大圖，完全無需依賴後端。
- **動態錨點與時間軸微調 (Live Anchor & Timeline Editing)**：提供視覺化的十字準星拖曳，可在動畫播放時即時調整精靈圖原點，解決 2D 骨架抖動問題。
- **高壓縮 WebP 匯出**：除標準 PNG 外，支援一鍵壓縮匯出高畫質、低容量的 WebP Spritesheet 與相容 PixiJS 的 `atlas.json`。
- **無縫生態系整合**：導出格式完美相容於 `@yshengliao/aiecsjs` (ECS) 與 `@yshengliao/aifsmjs` (狀態機)，並配合 `@yshengliao/aispritejs` 運行時播放。

---

## 📦 生態系關係 (Ecosystem Integration)

`aisprite-studio` 生產的資源，在遊戲中會透過以下方式協同運作：

```
[aisprite-studio] (設計 & 打包)
       │
       ▼ (匯出 atlas.json + sheet.webp)
┌──────────────────────────────────────────────┐
│                  遊戲運行時                   │
│                                              │
│  [aifsmjs] ───(狀態變更事件)───► [aispritejs] │
│   (邏輯決策)                       (動畫播放器) │
│                                       │      │
│  [aiecsjs] ◄───(更新精靈紋理)──────────┘      │
│   (ECS 實體)                                 │
└──────────────────────────────────────────────┘
```

---

## 🛠️ 技術棧與關鍵依賴 (Tech Stack & Dependencies)

為了實作純前端去背、打包、ZIP 下載以及 Rive-like 狀態機，本專案推薦使用以下技術與開源套件：

### 前端架構 & 渲染
- **Nuxt 3 & Vue 3**：核心開發框架，提供響應式狀態管理。
- **PixiJS v8**：動畫預覽渲染引擎，原生支援 WebP 載入、Anchor 錨點控制與時間軸控制。
- **Lucide Icons**：用於編輯器介面的現代化高質感圖示。

### 影像處理 & 打包
- **`free-tex-packer-core`**：純 JS 的 MaxRects 拼圖演算法核心，負責在前端自動裁剪 (Trim) 與拼接 Spritesheet。
- **HTML5 Canvas API**：用於讀取像素以實作 Chroma-key 去背，以及繪製大圖。
- **`jszip`**：在前端將多個資源（Spritesheet + atlas.json）打包成一個 `.zip` 供使用者一鍵下載。
- **`localforage` (或 IndexedDB)**：用於在瀏覽器端快取使用者的歷史專案與上傳的影格，防止網頁重新整理時資料遺失。

---

## 🛠️ 本地開發 (Local Development)

本專案基於 **Nuxt 3** 框架開發。

### 1. 安裝依賴
```bash
# 安裝相關套件
npm install
```

### 2. 啟動開發伺服器
```bash
npm run dev
```
瀏覽器會自動開啟 `http://localhost:3000`。

### 3. 編譯靜態版本 (Online 部署)
若要發布到 GitHub Pages 或 Vercel：
```bash
npm run generate
```
編譯後的靜態檔案會位於 `.output/public` 資料夾中。

---

## 📄 開源授權 (License)

Distributed under the MIT License. See `LICENSE` for more information.

---

## 👨‍💻 作者 (Author)

**yshengliao**
- NPM Profile: [https://www.npmjs.com/~yshengliao](https://www.npmjs.com/~yshengliao)
