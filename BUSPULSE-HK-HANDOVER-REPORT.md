# BusPulse HK 明亮模式與路線詳情交接報告

**專案：** [cw91020251212/gang-baa-im-si-buspulse-hk][1]  
**報告作者：** Manus AI  
**最後更新：** 2026-09-15 18:25（香港時間）  
**目前分支：** `main`  
**目前提交：** `30ae3f0`

## 目前結論

本輪工作已完成並部署到 GitHub Pages。路線詳情頁的明亮模式已改善可讀性，虛擬巴士提示已統一為單一生成來源，並且已改成貼近時間軸的細型提示。最新版本亦把提示文字調整至與下方車站中文名稱相同的左邊界。

最新線上網址為：<https://cw91020251212.github.io/gang-baa-im-si-buspulse-hk/?v=30ae3f0>。

## 使用者需求與最後採用的設計

使用者最初反映明亮模式中存在低對比問題，例如淺黃色文字置於白色背景上難以閱讀，並指出路線詳情頁的卡片、ETA、車站時間軸和提示區塊層次不足。後續重點集中在虛擬巴士提示：它必須位於車站時間軸上，巴士圖示中心要與時間軸及車站圓圈中心共用同一條垂直軸；描述文字要靠近巴士，並與下方車站中文名稱左對齊。

目前採用的視覺規則如下：

- 明亮模式使用白色卡片、淡藍灰背景及深色文字，避免淺色文字落在淺色背景上。
- 路線詳情頁的主時間軸、車站圓圈和虛擬巴士圖示採用同一個水平中心。
- 虛擬巴士只使用細型提示，不再使用大型巴士方框或大型描述方框。
- 描述文字使用左對齊，並貼近巴士；其左邊界與車站中文名稱一致。
- 上方 ETA 分鐘卡的設計與內容保留不變，使用者特別確認該部分是正確的。
- 程式只保留一個虛擬巴士生成來源，不可重新加入第二個獨立 ETA 生成器。

## 重要程式位置

所有本輪前端修改都在根目錄的 `index.html`。這個專案是單一 HTML 靜態網站，CSS 位於 `<style>` 區塊，路線詳情 DOM 由同一檔案內的 JavaScript 產生。

路線詳情相關區域大約位於以下位置：

- 詳情頁 CSS：`index.html` 約第 300 至 365 行。
- 詳情頁 DOM 生成：`index.html` 約第 1220 至 1250 行。
- 虛擬巴士唯一生成器：`deriveVirtualBusSegments(...)` 產生 `virtualSegments`，再由 `markerAfter` 產生 `.detail-inference.virtual`。
- 時間軸輸出：`.stop-timeline` 內由每個車站 row 和 `markerAfter.get(st.seq)` 組合而成。

目前最重要的 CSS 參數是：

- `.stop-timeline:before { left: 28px; ... }`
- `.detail-inference.virtual` 使用 `padding-left: 52px`。
- `.virtual-bus-card` 使用 `left: 6px`，寬度為 `30px`。
- `.detail-inference.virtual .bus-front-marker` 寬度為 `24px`，高度為 `17px`。
- `.virtual-bus-copy` 使用 `text-align: left`，描述文字左對齊。

這些數值是根據 `.stop-timeline` 的左內距、`.stop-row` 的站點圓圈欄寬和元素中心計算出來的。任何後續改動都應先在瀏覽器中確認實際盒模型，不要只靠肉眼調整 margin。

## 已完成的主要修改

### 明亮模式對比度

明亮模式由原本偏灰、層次接近的配色，改為白色卡片配淡藍灰背景。主要文字、次要文字、到站狀態、按鈕、地圖工具、設定區塊、時間表和提示框均加入明亮模式覆寫。這次改動的目標是提升對比度，而不是依賴黑色描邊或文字陰影。

### 詳情頁層次

路線摘要、目前車站、ETA 卡、服務資訊、車站列表和提示區塊使用不同背景及邊框層次。選中車站使用淡藍色，接近到站使用淡綠色，推算行駛使用藍色提示，避免所有區塊都接近同一種灰白色。

### 虛擬巴士提示

最初曾經加入大型左右兩個框，但使用者確認該設計過大，因為它比車站項目更突出。之後已改為細行提示。更重要的是，程式曾同時存在 `virtualSegments` 和 `independentNear` 兩個生成器，造成同一畫面出現兩種巴士版本。`independentNear` 已在提交 `ab99c19` 中整段刪除，目前只保留 `virtualSegments → markerAfter`。

### 文字位置

描述文字曾經先太遠，後來又太近。最後採用的規則是把 `.virtual-bus-copy` 的起始位置對齊車站中文名稱，而不是單純貼近圖示。上方 ETA 分鐘卡沒有被這次文字位置修改影響。

## 提交歷史

| 提交 | 內容 |
|---|---|
| `30ae3f0` | 將虛擬巴士描述文字對齊車站中文名稱。 |
| `377c4ad` | 對齊時間軸、車站圓圈及虛擬巴士中心，並固定描述左對齊。 |
| `ab99c19` | 刪除重複的 `independentNear` 虛擬巴士生成器。 |
| `3b1944d` | 曾將第二種提示套用到同一種樣式；後續由 `ab99c19` 徹底移除第二來源。 |
| `13417c9` | 將大型虛擬巴士框縮成細行提示。 |
| `b1fa342` | 嘗試以固定定位鎖定虛擬巴士中心。 |
| `6f69e23` | 將虛擬巴士放回時間軸附近。 |
| `026f912` | 改善路線詳情頁明亮模式對比度。 |
| `d7fb19b` | 改善整體明亮模式對比度。 |

## 驗證結果

本輪最後一次本地測試執行結果為 **21 個測試全部通過**。測試涵蓋路線詳情並發載入、ETA 解析、推算位置、方向切換、鍵盤操作、返回操作及首頁 smoke test。HTML 結構解析和 `git diff --check` 亦通過。

最新提交 `30ae3f0` 的 GitHub Actions workflow 已成功完成，包含以下步驟：

- 安裝依賴。
- 安裝 Playwright Chromium。
- 執行全部測試。
- 檢查 inline JavaScript 及 service worker 語法。
- 檢查 whitespace。
- 上傳及部署 GitHub Pages。

## 後續維護注意事項

後續 AI 接手時，請不要重新加入第二個「獨立 ETA 巴士」生成器。若要改善虛擬巴士內容，應只修改 `virtualSegments` 生成的 `.detail-inference.virtual` 元件。

請不要把虛擬巴士重新做成大型卡片。使用者已明確表示大型巴士框和大型描述框過度突出，並要求它與車站列表保持同一視覺節奏。

請不要修改上方 ETA 分鐘卡，除非使用者另行提出要求。使用者已確認該區域目前的呈現是正確的。

若需要調整水平位置，應先確認以下三個元素的實際中心是否一致：`.stop-timeline:before`、`.stop-dot:after` 和 `.virtual-bus-card` 內的 `.bus-front-marker`。調整後必須重新檢查車站圓圈與時間軸，不能只檢查虛擬巴士。

若需要調整文字位置，應以車站中文名稱的左邊界作為基準。不要讓描述文字上下各自置中，也不要用不同 margin 令兩行文字有不同起點。

## 參考資料

[1]: https://github.com/cw91020251212/gang-baa-im-si-buspulse-hk "BusPulse HK GitHub repository"
[2]: https://cw91020251212.github.io/gang-baa-im-si-buspulse-hk/?v=30ae3f0 "BusPulse HK GitHub Pages latest version"
[3]: https://github.com/cw91020251212/gang-baa-im-si-buspulse-hk/commit/30ae3f0 "Latest BusPulse HK alignment commit"
