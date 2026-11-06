# 地政總署實景3D

各原地圖正常開啟維持2D，左上角「3D」可切到官方實景模型，同一掣變「2D」可切返。路線詳情、路線卡、設定路線及落車選站使用同一個橋接。原站頭圖標和popup按鈕、路線線條、ETA巴士標記及GPS位置直接由原Leaflet圖層投影，不另造資料；原站頭點擊仍使用原回呼。切換保留中心及小數縮放，收起面板或移除地圖會釋放3D資源。

來源為地政總署[有貼圖3D Visualisation Map Tile-based Models](https://data.gov.hk/en-data/dataset/hk-landsd-openmap-3d-visualisation-map-tile-based-models)，與ParkPulse同用公開3D Tiles端點`https://data.map.gov.hk/api/3d-data/3dtiles/f2/tileset.json`。Cesium固定1.147.0，SDK、worker及貼圖解碼器由固定npm依賴準備，按網站子路徑載入；預設2D不載入SDK。

開3D後先出粗模型，再自動讀取畫面較精細細節。沿用已驗證6個同來源併發、最多兩次可取消重試及有限GPU快取；一次最多開一個3D場景。回2D或收起面板會清理SDK場景與事件。原通知、ETA與路線資料程式不改。

`npm test`執行原巴士回歸與3D橋接測試，並在pretest檢查JS語法和模型載入／取消策略。`npm run prepare:cesium`準備SDK；`node scripts/stage-site.mjs`打包純靜態Pages，保留原發布流程、不發佈node_modules或測試資料。

## 驗證記錄

2026-11-06：原全套215項測試212通過、2個既有選測跳過；一個原有焦點時序斷言單獨重跑通過。最後12項3D測試、popup點空白關閉與選項保留，以及原GPS／詳情相關測試合共18項再次通過。JS語法、真實核心Resource子圖塊重試继承、取消與LOD策略及18MB純靜態Pages資產檢查通過。實際SDK及官方模型／worker／WASM取得HTTP200；原站頭popup回呼、移動巴士／GPS投影及返回2D實測通過。
