# BusPulse：地政總署實景3D切換

沿用現有BusPulse介面、色彩、巴士路線和ETA資料，不另建网站。各既有地圖預設2D；加入同一個3D／2D切換控制，3D使用ParkPulse已上線的地政總署有貼圖實景模型與固定Cesium 1.147.0。SDK與模型只在開3D時載入；自動由粗模型提高細節，沿用6個併發、最多兩次可取消重試、有限GPU快取及錯誤返回2D。

3D橋接原Leaflet圖層與事件，保留站頭icon、選取站頭、路線線條、ETA巴士標記、GPS位置及原popup按鈕；應用程式仍操作同一批原圖層。切換保持目前中心及缩放；關閉路線面板／移除地圖時釋放3D資源。沿用原手機布局，原路線詳情和時間軸不改。

## 結構

`index.html`保留原主程式及UI，只載入新增橋接檔案。`landsd-map-provider.js`是各地圖共用入口，安裝切換控制並協調2D暫停／恢復。新增`landsd-3d-map.js`與CSS負責Cesium場景及原Leaflet圖層投影；`landsd-3d-runtime.js`及`scene3d.js`復用已驗證模型載入與距離換算。`scripts/prepare-cesium.mjs`準備固定SDK資產，原GitHub Pages workflow保存純靜態發布方式。新增測試與原測試共同保護巴士資料及地圖互動。
