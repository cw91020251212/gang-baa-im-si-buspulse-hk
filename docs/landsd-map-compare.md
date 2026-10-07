# LandsD 矢量地圖比較頁

本頁是 BusPulse HK 的獨立試驗畫面；主畫面現行底圖及公車路線／ETA 邏輯不受影響。

## 試驗頁功能

- 同一個香港視野並排顯示 Leaflet／OpenStreetMap 與 MapLibre／LandsD 官方矢量地圖。
- 拖曳及縮放預設同步，可取消同步；位置選單可比較中環・金鐘、旺角、沙田、屯門。
- LandsD 使用官方 Vector Map Root Style JSON，包含官方地圖符號（包括鐵路／MTR 圖標）、道路／建築圖層、sprites 與 glyphs；另疊上官方繁體中文標籤瓦片。
- LandsD 地圖影像面上有地政總署官方標誌和 copyright notice `Map from Lands Department`；外部連結直達官方 API 文件／使用條款。
- 比較頁不讀取巴士路線或 ETA。僅請求目前地圖視野的圖塊，不預載其他地區，符合 API 的節流注意事項。

## 官方來源

- [地政總署 Vector Map API 文件](https://portal.csdi.gov.hk/csdi-webpage/apidoc/VectorMapAPI)
- 官方樣式：`https://mapapi.geodata.gov.hk/gs/api/v1.0.0/vt/basemap/WGS84/resources/styles/root.json`
- 官方向量 PBF 模板：`https://mapapi.geodata.gov.hk/gs/api/v1.0.0/vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf`
- 官方繁體中文標籤 PNG 模板：`https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/tc/WGS84/{z}/{x}/{y}.png`
- 向量 URL 的 `WGS84` 大小寫及 `{z}/{y}/{x}` 順序不可任意改動；樣式 glyph 路徑的 `{fontstack}`、`{range}` 佔位符亦須保留。

## 性能量度定義

- **首塊**：第一個可見底圖／向量瓦片繪出所花的時間。
- **畫面就緒**：OSM 的首屏瓦片載入完成時間；LandsD MapLibre 首屏樣式、向量 PBF、標籤／符號資源載入並完成繪製的時間。
- **矢量塊**：僅計 LandsD ESRI vector source 的 PBF content events；不代表 PNG 標籤或 glyph 總數。
- 不計 Leaflet／MapLibre 函式庫下載。時間受裝置、網絡和快取影響，只是目前這次量度，不是 SLA 或普遍速度結論。

2026-10-07 於 Chromium／桌面 1440×960、中環・金鐘初始視野的一次 live 比較：

| 地圖 | 首塊 | 畫面就緒 | 計數 |
| --- | ---: | ---: | ---: |
| Leaflet／OpenStreetMap | 77 毫秒 | 104 毫秒 | 12 個 OSM tile events |
| MapLibre／LandsD（含官方 style 與繁中標籤） | 3.9 秒 | 7.7 秒 | 1 個向量 PBF content event |

這次測試中 LandsD 首屏明顯較慢。使用真實頁面時可重新整理比較；結果每次可能不同。

## 修改位置及驗證

- `landsd-map-compare.html`：比較 UI、互動控制、官方署名、量度方式。
- `landsd-map-compare.js`：官方樣式／瓦片 URL、glyph template 解決、繁體中文標籤 overlay、MapLibre／Leaflet 同步及時間量度。
- `assets/landsd-logo.png`：官方署名標誌。
- `tests/landsd-map-compare.spec.mjs`：不連外的 CI fixture 測試，以及明確 opt-in 的實際 API live 測試。
- `.github/workflows/pages.yml`：把比較頁、腳本及 logo 加入 GitHub Pages 發布白名單；測試檔、node_modules 不發布。

回歸驗證指令：

```bash
npx playwright test

BUSPULSE_LIVE_LANDSD=1 \
BUSPULSE_LANDSD_SCREENSHOT=/tmp/buspulse-landsd-map-preview.png \
npx playwright test tests/landsd-map-compare.spec.mjs --grep '@live'
```

## Troubleshooting 備註

先前自製 MapLibre style 把 `line-cap`／`line-join` 放入 `paint`，導致 style 在開始取 vector tiles 前已無法通過檢查；比較頁改載官方 Root Style JSON，並明確替換 `esri` source 的 PBF `tiles` URL。修正後以真實 Chromium 確認 LandsD PBF、sprite/glyph 及繁體中文標籤都能進入完成狀態，之後才進行發布。
