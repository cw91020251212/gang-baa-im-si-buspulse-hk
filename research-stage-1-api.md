# 香港官方巴士 API 研究（Stage 1）

> 研究範圍：官方 DATA.GOV.HK／運輸署公開文件與 `data.etabus.gov.hk` API；重點是 KMB route ETA 是否一次返回整條路線各站 ETA、route-stop 欄位、stop ETA、更新頻率、Scheduled Bus，以及官方 GPS 能力。本文只作研究，不改動程式。

## 結論摘要

**KMB Route ETA API 確實一次返回指定路線及服務類型的整條路線所有站點 ETA**：

```text
GET https://data.etabus.gov.hk/v1/transport/kmb/route-eta/{route}/{service_type}
```

官方規格明確寫明會返回 respective route 的 **all stops** ETA；回應格式與 ETA API 相同。每一筆資料以 `dir`（方向）及 `seq`（站序）定位站點，但 Route ETA 回應本身沒有 `stop` ID 或站名欄位，只有 `seq`，因此必須以每日更新的 route-stop 資料把 `(co, route, bound/dir, service_type, seq)` 對應到 `stop` ID，再以 stop 資料取得站名及座標。實際上可一次取得 outbound 和 inbound：分別呼叫 `service_type=1`、`service_type=2`（是否存在及實際服務類型須以路線清單確認）。

ETA 資料集官方標示**每 1 分鐘更新**；路線、站點、route-stop 等其他資料**每日更新**，API 規格目前標示靜態 API 在每日 **05:00** 更新。Route-stop 資源頁特別建議每天上午 5:00 後呼叫一次，重複呼叫不會得到更新資料。

`Scheduled Bus` 不是 GPS 或車輛識別：它是 ETA 記錄的 `rmk_en`（中文為「原定班次」）備註值。官方 KMB API／資料字典提供站點 `lat`、`long`，但沒有車輛 ID、車輛當前緯度／經度、速度或 heading 欄位；因此在這組官方 KMB ETA API 中，**沒有可供 BusPulse 使用的官方車輛 GPS feed**。ETA 可用作到站預報，但不能用來繪製巴士實時位置。

## 官方來源

|來源|用途與重點|
|---|---|
|[DATA.GOV.HK：九巴及龍運巴士路線實時到站數據](https://data.gov.hk/en-data/dataset/hk-td-tis_21-etakmb)|官方資料集總頁；資料提供者為運輸署，原始資料擁有人為 KMB／LWB；ETA 每分鐘更新、其他資料每日更新；提供 9 個 JSON 資源及官方規格／字典。|
|[Route ETA Data](https://data.gov.hk/en-data/dataset/hk-td-tis_21-etakmb/resource/11be6340-8ef1-42d2-a1e1-45bec949a9b1)|`/v1/transport/kmb/route-eta/{route}/{service_type}`；明確說明返回路線所有站點 ETA。|
|[Route-Stop Data](https://data.gov.hk/en-data/dataset/hk-td-tis_21-etakmb/resource/2dda0e97-fc4d-449c-bb98-a17228742eb4)|`/v1/transport/kmb/route-stop/{route}/{direction}/{service_type}`；返回指定方向路線的站序及 stop ID；每日更新，05:00 後取一次。|
|[Stop ETA Data](https://data.gov.hk/en-data/dataset/hk-td-tis_21-etakmb/resource/12185102-718d-4d03-bfd7-b9ecf760aee2)|`/v1/transport/kmb/stop-eta/{stop_id}`；一次返回該站所有路線的 ETA。|
|[ETA Data](https://data.gov.hk/en-data/dataset/hk-td-tis_21-etakmb/resource/2ea2591f-67e7-488d-83de-96ed48def51e)|`/v1/transport/kmb/eta/{stop_id}/{route}/{service_type}`；指定站、路線、服務類型，最多每方向 3 筆 ETA。|
|[KMB API Specifications v1.05（23 Oct 2024）](https://data.etabus.gov.hk/datagovhk/kmb_eta_api_specification.pdf)|官方端點、參數、樣本回應及更新時間；Route ETA 位於第 30 頁起，Route-stop 位於第 16 頁起。|
|[KMB Data Dictionary v1.02](https://data.etabus.gov.hk/datagovhk/kmb_eta_data_dictionary.pdf)|官方欄位定義；站點座標為 WGS84 decimal degree；ETA 的 `eta` 是時間戳，`data_timestamp` 是原始伺服器準備資料時間。|
|[官方即時 Route ETA（例：1A/1）](https://data.etabus.gov.hk/v1/transport/kmb/route-eta/1A/1)|實際 JSON 驗證；回應含完整站序、`generated_timestamp`／`data_timestamp`，在無可用班次時 `eta` 可為 `null`。|

## API 與欄位

### 1. Route ETA：整條路線各站 ETA

端點：`GET /v1/transport/kmb/route-eta/{route}/{service_type}`。輸入路線號及服務類型；回應 `type=RouteETA`，`data` 是多筆 ETA 記錄。每個方向的每個 `seq` 通常可有 `eta_seq=1..3`，即最多三個預報；官方樣本同時示範 outbound 與 inbound 需用對應的服務類型／請求。

Route ETA 的核心欄位如下：

|欄位|意義|在 Route ETA 的實作注意|
|---|---|---|
|`co`|巴士公司；官方值為 `KMB`，包含 KMB 及 LWB 路線服務|不要當成獨立車輛公司識別。|
|`route`|路線號，例如 `1A`|字串及大小寫敏感。|
|`dir`|方向，`O` outbound、`I` inbound|Route-stop 範例較常稱 `bound`；應在正規化層統一成同一方向欄位。|
|`service_type`|服務類型|JSON 樣本有時是數字；路徑參數是字串形式。|
|`seq`|該路線方向上的巴士站序號|**不是 stop ID**；需用 route-stop join。|
|`dest_tc` / `dest_sc` / `dest_en`|該班次目的地，中／簡／英文|是方向目的地，不是當前站名。|
|`eta_seq`|該站的第幾個 ETA（通常 1 至 3）|應按 `eta_seq` 排序，不應只取回應陣列順序。|
|`eta`|預計到站 ISO 8601 時間；可為 `null`|`null` 代表目前沒有可用 ETA，不能硬轉成 0 分鐘。|
|`rmk_tc` / `rmk_sc` / `rmk_en`|ETA 備註|`rmk_en="Scheduled Bus"`／中文「原定班次」表示班次性質；另有只限星期日／公眾假期等備註。|
|`data_timestamp`|資料由原始伺服器準備的時間|用於判斷資料新鮮度；不等於實際車輛 GPS 時間。|
|頂層 `generated_timestamp`|回應在快取前初次生成時間|官方字典說明它是初次生成時間；配合 `data_timestamp` 作 stale 判斷。|

### 2. Route-stop：把站序映射至 stop ID

端點：`GET /v1/transport/kmb/route-stop/{route}/{direction}/{service_type}`。官方樣本 `data` 欄位包括：

|欄位|意義|
|---|---|
|`co`|公司，官方為 `KMB`|
|`route`|路線號|
|`bound`|方向，`O` outbound、`I` inbound；端點的 `direction` 使用 `outbound`／`inbound`|
|`service_type`|服務類型|
|`seq`|站序，從 1 開始，作為 Route ETA 的 join key|
|`stop`|16 字元巴士站 ID，應再查 stop API／stop list|
|`data_timestamp`|靜態 route-stop 資料時間|

此外可用全量 `GET /v1/transport/kmb/route-stop` 取得所有路線 route-stop 關係。Route-stop 是每日靜態資料，規格標示每日 05:00 更新；資料集頁提醒不要高頻重試期待即時變更。

### 3. Stop ETA：以站為中心的替代查詢

端點：`GET /v1/transport/kmb/stop-eta/{stop_id}`。它一次返回該 stop 的**所有路線** ETA，資料欄位基本上與 ETA／Route ETA 相同，另外含路線、方向及站序；適合「乘客在某站等什麼車」的畫面。指定路線／站則用 `GET /v1/transport/kmb/eta/{stop_id}/{route}/{service_type}`，官方說明每方向最多 3 筆 ETA。

重要交叉服務限制：官方規格指出，某服務類型的 ETA 若與同一路線其他服務類型共用同一站，回應也可能包含那些其他服務類型的 ETA；不可只依請求的 `service_type` 假設回應一定只有一組。

### 4. 靜態 Stop 資料

`GET /v1/transport/kmb/stop`（全量）或 `/stop/{stop_id}`（單站）提供：`stop`、`name_tc`、`name_sc`、`name_en`、`lat`、`long`、`data_timestamp`。`lat`／`long` 是站點位置，WGS84 十進制座標；它們不是巴士車輛位置。

## 可行性評估

|需求|可行性|理由／實作方向|
|---|---|---|
|顯示某條 KMB 路線上下行所有站及 ETA|**高**|Route ETA 一次返回所有站的 ETA；route-stop 提供 `seq → stop`，stop API 提供名稱及座標。|
|顯示指定站所有路線 ETA|**高**|Stop ETA 一次返回該站所有路線。|
|顯示每站最多三班下一班車|**高，但要容錯**|以 `eta_seq` 分組；`eta` 可能 `null`，也可能附帶 Scheduled Bus／服務限制備註。|
|建立穩定站點／路線拓撲|**高**|每日 05:00 後同步 route、stop、route-stop；本地持久化並以 `data_timestamp`／內容 hash 更新。|
|用 ETA 回應重建車輛在路線上的位置|**低／不可作官方 GPS**|只有站序和預報到站時間，沒有 vehicle ID、車輛 lat/long、速度或 heading；只能做 ETA 視覺化或粗略進度推算，不能聲稱實時位置。|
|依 ETA 區分實際行駛車與排班班次|**有限**|可讀 `rmk_en` 的 `Scheduled Bus`，但這是備註而非車輛狀態／識別，也不提供取消、車牌或 GPS。|

## 更新、快取與可靠性建議

1. **靜態資料快取一天一次**：每天 05:05（或 05:10）同步 route list、stop list、route-stop list、route detail；官方 route-stop 明確建議 05:00 後呼叫一次。應保留上一版，避免每日資料短暫空白時整個拓撲消失。
2. **ETA 以 60 秒為官方粒度**：後端可每 60 秒刷新；前端倒數可每秒計算，但不要每秒重呼叫官方 API。考慮加入 5–15 秒 jitter，避免大量客戶同一秒打到 API。
3. **按查詢需要選端點**：路線頁用 Route ETA（每條路線／服務類型一個回應）；站點頁用 Stop ETA（每站一個回應）。不要為每一個站逐一呼叫 ETA，否則不必要放大請求量。
4. **以時間戳判斷 freshness**：記錄 `generated_timestamp`、每筆 `data_timestamp` 及抓取時間；若 `data_timestamp` 落後超過約 2–3 分鐘，UI 顯示「資料可能延遲」而不是假裝即時。此為應用層建議，官方只承諾資料更新頻率為每分鐘。
5. **正確處理空值及備註**：`eta=null` 是合法回應；保留 `rmk_tc/sc/en`，特別是 `Scheduled Bus`、星期日／公眾假期及其他營運限制。不可把 `null` 當作「已到站」或「沒有這個站」。
6. **正規化方向與型別**：Route-stop 使用 `bound`，ETA 使用 `dir`；`service_type` 在不同樣本可能呈現字串或數字。資料庫建議以字串保存路線號／服務類型，另以標準化 `direction` 欄位保存 `I`／`O`。
7. **快取失敗時保留 stale-while-revalidate**：API 錯誤、超時或 422／500 時可短時間提供最後成功資料並標示時間；不要因一次 ETA 失敗清空路線。對靜態資料應使用長 TTL（約 24 小時）並以每日刷新取代反覆重試。
8. **不要把官方更新頻率誤解成每秒 GPS**：資料集的「ETA 每 1 分鐘」是資料更新週期，不代表預報誤差、車輛位置精度或所有路段均每分鐘有實車訊號。

## 主要限制與風險

- 官方資料集同時覆蓋 KMB／LWB，雖然 `co` 官方值為 `KMB`；產品若只想顯示九巴，需按路線／公司規則確認範圍。
- Route ETA 沒有 `stop` ID；必須依 `seq` 與 route-stop 對接。路線改站、方向或服務類型變動時，不能永久硬編站序。
- ETA 是預計時間，不是保證到站時間；`eta` 可為 `null`，而且回應可能跨其他共用服務類型。
- 官方文件及實際 API 是公開 JSON，但仍應設置 timeout、重試上限、快取及退避，並遵守運輸署／營辦商網站的臨時改道公告；官方總頁提醒改道安排應查看公共交通營辦商網站。
- 研究到的官方 KMB ETA 規格與字典沒有車輛位置資料。若產品需要官方 GPS，應另找運輸署／營辦商明確公布的車輛位置資料集；不能從這套 ETA API 推導為「官方 GPS」。

## 最小可行整合流程

```text
每日 05:00 後：route + stop + route-stop → 建立 route/方向/服務類型/seq/stop 拓撲
每 60 秒：route-eta/{route}/{service_type} → 以 (route, dir, service_type, seq) join stop
或按站：stop-eta/{stop_id} → 直接按 route/dir/seq 顯示 ETA
顯示層：eta_seq 排序；eta=null 顯示無可用預報；保留 Scheduled Bus 及其他備註
```

**判定：** 對「BusPulse HK 顯示 KMB 路線每站到站預報」而言，官方 API 可行且 Route ETA 正是合適入口；對「顯示巴士實時 GPS／地圖車位」而言，這組公開官方 API 不足，須另尋明確的車輛位置來源或把功能降級為基於 ETA 的站點進度視圖。
