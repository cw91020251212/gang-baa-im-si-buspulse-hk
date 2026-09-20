# BusPulse HK（港巴即時）— AI 修改交接說明

## 專案用途

這是一個純前端 Progressive Web App（PWA），用來顯示香港巴士及綠色專線小巴的實時到站資料。網站品牌名稱是「港巴即時｜BusPulse HK」，主要以繁體中文／香港廣東話介面顯示，適合手機使用。

## 主要功能

1. 使用者可以選擇九巴／龍運、城巴／新巴或綠色專線小巴。
2. 輸入部分路線號碼即可搜尋，例如輸入 `74` 會找出 `74K`、`74X` 等以 74 開頭的路線。
3. 選擇行車方向及站頭後，在主畫面顯示未來班次 ETA、到站分鐘、預計時間及備註。
4. 每張路線卡可以顯示官方車資、路線地圖及 GPS 定位附近站頭。
5. 路線地圖顯示站點、選定站頭、道路網絡模擬路徑；路徑不是巴士公司的實際 GPS 軌跡。
6. 可以在地圖上查看附近站頭，並直接選擇站頭。
7. 每張路線卡有到站／落車提醒鬧鐘。開啟後，當 ETA 進入設定時間，卡片會閃爍、播放短鈴聲、嘗試震動，並可使用瀏覽器系統通知。
8. 偏好設定包括：提醒提前 1／2／3／5 分鐘、標準／較大字體、12／24 小時制、黑暗／光明模式。
9. 設定及已選路線使用 localStorage 保存在本機瀏覽器。
10. 支援 PWA manifest、service worker 及加入手機主畫面。
11. 原本曾提供「開啟最上層小窗」；因手機支援度低，現已從設定頁移除，避免使用者誤會。需要同時睇 ETA 同使用其他 App 時，應使用手機系統分割畫面（如裝置支援）。

## 技術結構

- `index.html`：主要及幾乎全部的 HTML、CSS 和 JavaScript。這是一個單頁純前端應用。
- `manifest.json`：PWA 應用程式設定。
- `sw.js`：service worker 及離線快取。修改資源時要同步更新 cache version，避免手機繼續使用舊版本。
- `fare-index.json`：由運輸署官方路線及收費 GeoJSON 整理出的精簡車資索引，約數千條 key-value，格式為 `COMPANY|ROUTE|ROUTE_SEQUENCE` 對應官方 `fullFare`。
- `icon-192.png`、`icon-512.png`：PWA 圖示。
- `README.md`：一般專案說明。
- `CHANGELOG.md`：按日期記錄每次修正、測試、部署版本、已知限制及回退追查資料。

## API 資料來源

- KMB／LWB ETA：`https://data.etabus.gov.hk/v1/transport/kmb`
- Citybus ETA：`https://rt.data.gov.hk/v2/transport/citybus`
- GMB：`https://data.etagmb.gov.hk`
- 地圖底圖：Leaflet + OpenStreetMap
- 道路路徑模擬：OSRM public routing service
- 車資來源：運輸署 `https://static.data.gov.hk/td/routes-fares-geojson/JSON_BUS.json` 及 `JSON_GMB.json`，已經抽取成 `fare-index.json`。

## 重要資料限制

官方 ETA API 提供到站預計時間，但沒有普遍公開每一架巴士的實時 GPS 座標。因此程式不能準確顯示「下一架巴士的真實位置」。目前地圖上的 GPS 圓點是使用者自己的位置，藍色路線是道路網絡模擬，不是巴士實時位置。

官方車資 GeoJSON 主要提供路線 `fullFare`，不是完整的逐站分段票價表。因此介面顯示的是該路線官方全程車資，不應把它改稱為根據上下車站計算的分段車費，除非找到可靠的官方分段票價資料。

到站鬧鐘是瀏覽器內的輪詢功能，目前每 25 秒更新一次 ETA。當頁面完全關閉、手機鎖屏或瀏覽器被系統暫停時，JavaScript 音效和震動可能無法執行；瀏覽器通知權限可以改善提示，但不能保證所有手機背景狀態都運作。

Document Picture-in-Picture 小窗同樣取決於瀏覽器平台支援。小窗內容由主頁收到最新 ETA 後更新；它不是獨立的 Android 背景服務。Android 平台若沒有 Document PiP，可用系統分割畫面同時顯示本 PWA 和音樂 App。

## 開發及修改注意事項

1. 修改後必須用 Node 檢查 `index.html` 內聯 `<script>` 的 JavaScript syntax。
2. 修改 service worker 快取版本，否則手機可能看不到新版本。
3. 不要把 API key 放進前端；本專案目前不使用使用者 API key。
4. 不要將官方 API 大型原始車資 GeoJSON 直接放入瀏覽器 fetch；`fare-index.json` 是為了減少檔案大小及避免官方檔案沒有 CORS header。
5. 要保留車資載入失敗隔離：即使 `fare-index.json` 讀取失敗，也不能令巴士路線主畫面白屏。
6. `localStorage` key 包括 `busboard.items.v1`、`busboard.preferences.v1`、`busboard.alarms.v1`。修改資料結構時應提供向後兼容或 migration。
7. 這個專案適合以 GitHub Pages 發布；目前公開 repository 及網站部署流程使用 GitHub Actions。
8. UI 以手機優先，避免在每張路線卡加入太高的控制列；地圖及不常用功能應保持可按但不佔用太多主畫面高度。

## 目前發布位置

## 目前背景通知及測試工具狀態

最新主分支提交為 `9915863`。近期版本加入了 Service Worker 系統通知、App badge、提示聲選項、延遲背景通知測試及相關交接紀錄；請先閱讀 `CHANGELOG.md` 內 2026-09-07 的連續背景通知修正記錄，再判斷是否需要繼續修改。設定頁現已將提示聲款式、提示聲長度、聲音來源、試聽提示聲、延遲背景測試及倒數狀態集中在可收合的「測試工具」區塊，保留原有 element IDs 及事件處理。

版本回退測試曾由最新提交逐級向後進行；`dc4c7b7` 及更早版本已證實不符合目前背景提示需求，不應直接覆蓋最新主分支。若要繼續追查，應先建立保護分支，逐一記錄實機測試結果，再改動 `index.html` 或 `sw.js`。純 GitHub Pages 前端仍依賴瀏覽器背景執行；Service Worker 的 `showNotification()` 可改善系統通知，但不是伺服器 Push，也不能宣稱所有鎖屏／強制停止狀態必然可靠。

## 目前發布位置

- Repository：`https://github.com/cw91020251212/gang-baa-im-si-buspulse-hk`
- GitHub Pages：`https://cw910202512.github.io/gang-baa-im-si-buspulse-hk/`

## 交給另一個 AI 的建議指示

請先完整閱讀本檔案、`README.md`、`index.html`、`manifest.json` 和 `sw.js`，再修改程式。修改前先說明打算改動的檔案和風險；修改後必須：

- 保持手機版介面簡潔；
- 保留原有 ETA、地圖、GPS、車資、鬧鐘及偏好設定功能；
- 檢查 JavaScript syntax；
- 檢查 PWA manifest 及 service worker；
- 說明任何官方 API 資料限制；
- 不要聲稱沒有官方資料支持的巴士實時 GPS 或精確分段票價功能已經存在。

語言方面，預設使用香港繁體中文及自然廣東話 UI 文字；技術註解及 README 可以使用英文或雙語。

## 2026-09-21：到站聲音的不可破壞規則

**只有該路線已手動開啟的鬧鐘，才可以自動發聲、震動或送出有聲到站通知。** 字體、圖示、深淺色、重新整理、ETA 更新、通知權限及普通畫面重繪都不構成開啟鬧鐘的同意。關閉狀態必須跨重新載入保留；真正已開啟的設定亦應正常保留，而不是每次更新都全部重置。

自動提醒必須同時通過 `isAlarmSessionActive(id, session)` 的記憶體狀態、localStorage 開關、session 及路線存在檢查。每次手動重新開啟都產生新 session，舊計時器／舊 ETA 計劃不能沿用。每個非同步等候之後，必須在音效或通知的實際副作用之前重新驗證；單獨的 `alarmAuthorized: true` 不是有效授權。

到站提醒開始時保留亮起的鬧鐘狀態，讓使用者可以關閉並即時停止聲音；同一提醒使用 `activeAlarmAlerts` 防止重複，提示結束後才解除一次性鬧鐘。不可再回復「先將鬧鐘顯示關閉，再送出有聲通知」的舊流程。個別關閉、全部關閉、移除路線、還原備份及跨分頁關閉都必須取消對應音效、計時器、計劃、session 和外部通知。使用者主動按「試聽／測試通知」是明確操作，不屬於自動到站提醒。

Service Worker 只接受 `BUS_ARRIVAL_AUTHORIZED`，並透過 MessageChannel 向來源頁面核對當前 session。沒有回應、沒有授權或已撤銷時必須拒絕；舊 `BUS_ARRIVAL` 訊息不可直接播放通知。瀏覽器本地定時通知使用 `showTrigger`，建立前後都要驗證及處理取消競爭。

任何 UI 或聲音修改都要通過 `npm test`，尤其是 `tests/alarm-authorization.spec.mjs` 及 `tests/alarm-worker.spec.mjs`。測試包含關閉鬧鐘、非聲音設定修改、await 期間關閉、關閉再開啟、跨分頁關閉、重新載入、移除路線、一次性解除，以及真實網頁／Service Worker 授權往返。部署新版本後，舊分頁仍可能繼續執行舊 JavaScript；要求使用者關閉舊分頁再重新開啟一次，並不要聲稱已在使用者的手機上完成實機音效驗證。
