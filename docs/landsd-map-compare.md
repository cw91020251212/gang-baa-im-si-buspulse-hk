# LandsD 矢量底圖：比較頁與主地圖整合

BusPulse HK 主路線地圖已採用香港地政總署官方 Vector Map 作底圖；獨立比較頁仍可將 LandsD 與 OSM 並排查看，方便比較清晰度、地圖內容和載入時間。底圖切換不會改動巴士 ETA、位置推算、路線線段、車站或虛擬巴士演算。

## 主地圖整合

- 既有 Leaflet 地圖繼續承載巴士路線線段、車站（包括已選車站）、估算巴士和 GPS marker；LandsD 只取代底圖層。
- 透過 MapLibre GL JS `6.3.0` 與 `@maplibre/maplibre-gl-leaflet` `0.1.4`，在 Leaflet 地圖下繪製官方矢量樣式；MTR／鐵路符號使用官方 style sprite 與 layer。
- 官方 Vector Map Root Style JSON 負責道路、建築、地物和符號；另疊加官方香港繁體中文標籤 PNG tile。
- 地圖影像面上顯示地政總署官方標誌和 `Map from Lands Department` copyright notice；Leaflet attribution 亦保留路線資料來源。
- LandsD style、PBF、label tiles 或 MapLibre 模組失敗時會回退至原 OSM tile layer，並保留 route／stop／bus overlays。
- 收合路線地圖或關閉 bottom sheet 時暫停 GL layer；重開時重新掛載；route cards 重繪或 map DOM 移除時釋放 Leaflet map／WebGL context。
- Service Worker shell cache 為 `v115-landsd-vector-map`，預先快取 provider JS／CSS 與署名 logo。

## 獨立比較頁

- 同一香港視野並排顯示 Leaflet／OpenStreetMap 與 MapLibre／LandsD 官方矢量地圖。
- 拖曳及縮放預設同步，可取消同步；位置選單可比較中環・金鐘、旺角、沙田、屯門。
- 顯示載入時間與瓦片計數。比較頁不讀取巴士路線或 ETA，只請求目前地圖視野的瓦片，不預載其他地區。

## 官方來源與 API

- [地政總署 Vector Map API 文件](https://portal.csdi.gov.hk/csdi-webpage/apidoc/VectorMapAPI)
- 官方樣式：`https://mapapi.geodata.gov.hk/gs/api/v1.0.0/vt/basemap/WGS84/resources/styles/root.json`
- 官方向量 PBF 模板：`https://mapapi.geodata.gov.hk/gs/api/v1.0.0/vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf`
- 官方繁體中文標籤 PNG 模板：`https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/tc/WGS84/{z}/{x}/{y}.png`
- 向量 URL 的 `WGS84` 大小寫及 `{z}/{y}/{x}` 順序不可任意更改；官方 style glyph 路徑中的 `{fontstack}`、`{range}` 佔位符必須保留原樣。

## 比較頁性能基準

**一次 Chromium live 量度**：2026-10-07，桌面 1440×960，中環・金鐘初始視野。比較數據只描述當次裝置、網絡和快取情況，不是 SLA 或普遍速度結論。

| 地圖 | 首塊 | 畫面就緒 | 計數 |
| --- | ---: | ---: | ---: |
| Leaflet／OpenStreetMap | 77 毫秒 | 104 毫秒 | 12 個 OSM tile events |
| MapLibre／LandsD（含官方 style 與繁中標籤） | 3.9 秒 | 7.7 秒 | 1 個向量 PBF content event |

這次量度中 LandsD 首屏明顯較慢；可打開比較頁即時重測。

## 修改位置及測試

- `landsd-map-provider.js`／`.css`：主路線地圖 provider、繁中標籤疊圖、官方 logo 署名、OSM fallback 與 GL context 回收。
- `landsd-map-compare.html`／`.js`：獨立比較 UI、官方樣式／瓦片、標籤疊圖、同步和計時。
- `assets/landsd-logo.png`：官方署名標誌。
- `tests/landsd-main-map.spec.mjs`：主地圖載入、瓦片、署名、Leaflet overlays、暫停／恢復與 OSM fallback 的離線整合測試；另有明確 opt-in 的 live API 測試。
- `tests/landsd-map-compare.spec.mjs`：並排比較頁的離線測試及 opt-in live API 測試。
- `.github/workflows/pages.yml`：Pages 發布白名單與腳本檢查；測試檔及 node_modules 不會發布。

```bash
node --check landsd-map-provider.js
npx playwright test tests/landsd-main-map.spec.mjs tests/landsd-map-compare.spec.mjs
npx playwright test

# 真實 LandsD requests：手動 opt-in，遵守官方 API 節流
BUSPULSE_LIVE_LANDSD=1 \
BUSPULSE_LANDSD_MAIN_SCREENSHOT=/tmp/buspulse-landsd-main-map.png \
npx playwright test tests/landsd-main-map.spec.mjs --grep '@live'

BUSPULSE_LIVE_LANDSD=1 \
BUSPULSE_LANDSD_SCREENSHOT=/tmp/buspulse-landsd-map-preview.png \
npx playwright test tests/landsd-map-compare.spec.mjs --grep '@live'
```

## 已解決的載入問題

曾將官方 style 的 glyph 相對 URL 交由 `new URL()` 解析，導致 `{fontstack}` 與 `{range}` 被百分號編碼，MapLibre 無法讀取字型模板並觸發 OSM fallback；現會保留模板括號。Playwright 的 MapLibre raster fixture 使用有效 256×256 PNG，避免 1×1 示意圖導致 WebGL image decoder error。
