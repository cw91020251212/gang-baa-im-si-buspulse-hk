# BusPulse HK 路線詳細頁與逐站 ETA：工程交接最終報告

**版本：** 1.0  
**日期：** 2026-09-15  
**作者：** Manus AI  
**專案：** `gang-baa-im-si-buspulse-hk`  
**研究範圍：** 將已完成的總體、官方 API、UX 與檔案級實作研究整合為可執行的工程交接規格。本報告本身不包含產品程式修改。

## 1. 執行結論

BusPulse HK 可以在現有單頁前端 PWA 上，安全地加入「由路線卡進入全畫面路線詳細頁」功能。第一版應顯示完整站點時間線、所選站的三格 ETA、資料新鮮度與錯誤狀態，並重用既有的公司 API adapter、ETA normalizer、`routeStopsCache`、ETA snapshot 及深／淺色 CSS variables。詳細頁是**暫態、唯讀的資訊檢視**；它不應改寫使用者已儲存的路線卡上車站，也不應啟動 GPS、到站鬧鐘、聲音、震動、通知或 Service Worker 訊息。

對 KMB／LWB 而言，官方 Route ETA API 可在一次呼叫中提供指定路線及服務類型的全線各站 ETA；但回應以方向與站序 `seq` 識別站點，沒有 `stop` ID 或站名。因此，實作必須以每日同步的 route-stop 資料將 `(co, route, direction, service_type, seq)` 對接到 stop，再以 stop 資料補齊站名與座標。[1] [2] [3] 官方資料集承諾 ETA 約每分鐘更新；路線、站點及 route-stop 等靜態資料約每日更新，route-stop 建議在每日 05:00 後取得。[1] [3]

> **核心真實性結論：** 官方 KMB ETA 資料提供的是到站預報，並不提供車輛 ID、車輛即時經緯度、速度或 heading。產品可以把相鄰站的可信 ETA 視覺化為保守的站間進度，但不得把結果稱為「即時巴士位置」、「實時追蹤」或 GPS。[5] [6]

第一版的完成標準如下：使用者可由任何路線小卡一次進入並返回完整路線頁；可點選任何車站、立即切換頂部三格 ETA；遇到空值、離線、過期或 API 失敗時有誠實文字；只在嚴格條件通過時顯示一個「推算中」標記；明暗主題、字型放大、鍵盤和手機觸控均可使用；而詳細頁全程沒有任何 GPS 或鬧鐘副作用。

| 面向 | 第一版決策 | 不可違反的界線 |
| --- | --- | --- |
| 架構 | 保持單頁純前端 PWA；不新增後端、帳戶、推送或背景代理。 | 不把詳情 ETA 接入主板 `refresh()` 的鬧鐘鏈。 |
| 全線 ETA | KMB 優先使用一次 Route ETA 呼叫，再按站序分組；其他公司沿用既有逐站 adapter。 | 不為每個 KMB 站重複請求同一條 route ETA endpoint。 |
| 車輛視覺 | 僅作 ETA 推算的站間 marker。 | 不當作 GPS、不得畫道路軌跡、速度或精確座標。 |
| 儲存 | 詳情選站與全線 ETA 是記憶體暫態；只可重用既有 ETA snapshot。 | 第一版不新增 localStorage key，不修改備份 schema。 |
| 互動 | 卡片進入、選站、切換方向、重試及捲動只讀取／顯示資料。 | 零 GPS、零通知權限、零鬧鐘、零聲音、零震動。 |
| 發佈 | 加入測試 gate 後才部署 GitHub Pages；更新 PWA shell 版本。 | 不快取 `gov.hk` ETA 回應；回滾時要再提升 shell 名稱。 |

## 2. 範圍、非目標與工程不變條件

本功能的產品目標是讓乘客在一個可返回的全畫面頁面中，理解特定路線方向的完整站序，並在任一站查看最多三個後續 ETA。站點時間線是主體；頂部 ETA 區隨目前選中的站改變。方向切換必須是獨立、明確的操作，而非點擊摘要文字後的隱性行為。

本頁**不是**地圖導航、巴士 GPS 追蹤、完整班次表、落車提醒設定頁或鬧鐘設定頁。現有 GPS、到站鬧鐘、通知和音效只能維持在原有、具明確意圖的控制之下。載入詳情、選站、捲動、切換方向及重新載入，都不得呼叫 `navigator.geolocation`、`Notification.requestPermission()`、`ringBell()`、震動、音效、Service Worker `postMessage()`、`scheduleAlarmFallbacks()`、`checkAlarms()` 或任何改寫 alarm/get-off state 的程式。

程式碼應在 `loadRouteDetailEtas` 及每個 ETA queue worker 附近留下可 review 的不變條件註解：這些路徑只能呼叫 API adapter／`fetchETA`、snapshot helper、資料轉換和 detail renderer。它們不得讀寫 `alarms`、`alarmPlans`、`alarmSessions`、`alarmSeen`、`alarmFallbackTimers`、`getoff`、`prefs.notificationsEnabled` 或既有 `items`。

## 3. 官方資料來源與使用準則

下表列出實作 ETA 與站點拓撲時應優先使用的官方來源。資料集頁列明提供者為運輸署，資料擁有人為 KMB／LWB；實作時須尊重其資料更新節奏，不得把每分鐘 ETA 更新誤解為每秒 GPS 定位。[1]

| 資料／文件 | 官方端點或來源 | 用途 | 更新與限制 |
| --- | --- | --- | --- |
| KMB／LWB 資料集總頁 | DATA.GOV.HK 資料集 [1] | 查核資料擁有人、更新頻率、JSON 資源與官方文件。 | ETA 約每 1 分鐘；其他資料約每日更新。 |
| Route ETA | `GET /v1/transport/kmb/route-eta/{route}/{service_type}` [2] | 一次取得指定 route／service type 的各站 ETA，供路線詳情 KMB sweep 使用。 | 回應以 `dir`、`seq` 定位；無 stop ID／站名；`eta` 可為 `null`。 |
| Route-stop | `GET /v1/transport/kmb/route-stop/{route}/{direction}/{service_type}` [3] | 把 ETA 的站序映射至 stop ID，建立路線拓撲。 | `direction` 用 `outbound`／`inbound`，回應 `bound` 用 `O`／`I`；每日 05:00 後同步。 |
| Stop ETA | `GET /v1/transport/kmb/stop-eta/{stop_id}` [4] | 站點中心畫面或除錯用；一次返回該站不同路線 ETA。 | 不適合作為全線逐站 N 次輪詢的預設方案。 |
| 指定站／路線 ETA | `GET /v1/transport/kmb/eta/{stop_id}/{route}/{service_type}` [7] | 單站、指定路線查詢與交叉驗證。 | 官方說明每方向最多三筆；共用站可能帶回其他 service type。 |
| 靜態站點資料 | `GET /v1/transport/kmb/stop` 或 `/stop/{stop_id}` [6] | 補齊 `stop`、中英站名、WGS84 `lat`、`long`。 | 站點座標是車站座標，不是車輛位置。 |
| 官方 API 規格 | KMB ETA API Specification [5] | 實作端點、方向、服務類型、時間欄位與範例回應的權威依據。 | 規格及實際 API 變更時以官方最新版為準。 |
| 官方資料字典 | KMB Data Dictionary [6] | 確認欄位意義、WGS84、`data_timestamp` 與 `generated_timestamp`。 | 不可把資料產生時間視為車輛 GPS 時間。 |

### 3.1 API 選擇與請求策略

路線詳細頁的 KMB 資料路徑應為「route-stop 建拓撲 + route ETA 補動態資料」。開啟頁面後先以 cache 或 API 取得完整站點陣列；站點完成後立刻優先載入目前卡片所選站的 ETA；其餘站點資料才在背景載入。對 KMB，背景 sweep 應只抓取**一次** Route ETA 回應，按 `(dir, seq, service_type)` 分組後填入各 stop。對 Citybus／GMB，若現有 adapter 為逐站 endpoint，維持既有 `etaCTB()`／`etaGMB()` normalizer，採固定併發上限三條的可取消 queue，避免改寫已驗證的解析邏輯。

所有動態請求應保留既有 12 秒 timeout、`cache: 'no-store'`、過期 ETA 過濾、排序及最多四筆內部結果的規則；UI 僅顯示前三筆。前端可每秒以本地時鐘重新計算「尚餘分鐘」，但不得每秒重呼叫官方 API。服務端資料約每 60 秒更新，實作建議以 60 秒刷新加 5–15 秒 jitter，避免多個客戶端同秒請求。[1]

靜態路線、stop、route-stop 資料在每日 05:05 或 05:10 後同步一次，並保留成功的上一版。若同步失敗，不可清空現有拓撲；應採 stale-while-revalidate，保留已知站點並顯示資料時間。靜態資料的高頻重試既不會得到更即時結果，亦可能造成不必要負載。[3]

## 4. 逐站 ETA 資料模型與資料生命週期

### 4.1 正規化與 join 規則

KMB ETA 的 `dir` 與 route-stop 的 `bound` 必須在資料層先統一為 `direction: 'O' | 'I'`。`service_type` 可能在 JSON 內出現數字、在 URL 內作字串；儲存和 key 組合均應正規化為字串。不可用站名當識別鍵，因站名可重複、修訂或有不同語言版本。

| 來源資料 | 正規化欄位 | join key／處理 | 禁止做法 |
| --- | --- | --- | --- |
| Route-stop | `co, route, direction, serviceType, seq, stopId` | 以 `co|route|direction|serviceType|seq` 唯一定位站序。 | 以 `seq` 脫離 route／方向／service type 單獨 join。 |
| Stop | `stopId, nameTc, nameEn, lat, lng` | 以 `stopId` 補站名與站點座標。 | 將 `lat/lng` 標為巴士車輛位置。 |
| Route ETA | `co, route, direction, serviceType, seq, etaSeq, iso, remark, scheduled, dataTimestamp` | 以完整站序 key 對應 `RouteStop`；每站依 `etaSeq` 排序。 | 依 API 回應原始陣列順序顯示，或把 `eta=null` 轉成 0 分鐘。 |
| 既有 ETA snapshot | `etas, savedAt, source` | 只以該站自己的 `uid` 讀取，且不超過 20 分鐘。 | 用另一站 ETA、舊路線或另一方向 ETA 填空。 |

建議以純函式建立 route variant key。它代表整個路線變體，而非使用者在該路線上選擇的上車站：

```text
KMB: co|route|dir|service_type
CTB: co|route|dir|bound
GMB: co|route_id|route_seq
```

`routeStopsCache` 應統一透過 `getRouteStopsCached(it, { signal })` 存取。流程是先計算 variant key；命中時直接回傳；未命中才呼叫既有 `routeStops(it)`；驗證回傳陣列已排序而且 `seq` 與 `id` 均唯一後才寫入 cache。另設置 in-flight promise map，讓詳情頁、地圖和 get-off setup 同時需要同一路線時共用一條請求。abort 或 reject 時必須移除 promise，絕不可 cache 失敗或半截資料。

### 4.2 建議的型別／記憶體狀態

以下是以 JavaScript 物件呈現的建議資料契約。實際專案可不導入 TypeScript，但應遵守相同欄位語意，以便測試、adapter 與 renderer 共用。

```js
// 全線拓撲；成功驗證後才放入 routeStopsCache
RouteStop = {
  seq: Number,                 // 路線方向內由 1 起的站序
  id: String,                  // stop ID
  name: String,                // 繁中顯示名
  nameEn: String | null,
  lat: Number | null,          // 車站座標；非車輛位置
  lng: Number | null
};

// 既有 normalizer 輸出應擴充／維持的單班 ETA 語意
EtaTrip = {
  iso: String | null,          // 官方 ETA ISO 8601；null 為無可用預報
  min: Number | null,          // 由 iso 相對 now 計算，不能把 null 轉 0
  rmk: String | null,          // 保留營運備註
  sched: Boolean,              // rmk 表示 Scheduled Bus／「原定班次」
  etaSeq: Number | null,
  dataTimestamp: String | null
};

StopEtaState = {
  status: 'loading' | 'ready' | 'empty' | 'stale' | 'error',
  etas: EtaTrip[],             // 永遠屬於同一 stop UID
  fetchedAt: String | null,    // 本程式取得時間
  sourceTimestamp: String | null,
  cachedAt: String | null,
  error: String | null
};

routeDetailState = {
  open: Boolean,
  routeId: String | null,
  variantKey: String | null,
  stops: RouteStop[],
  stopsStatus: 'idle' | 'loading' | 'ready' | 'error',
  stopsError: String | null,
  selectedSeq: Number | null,
  selectedStopId: String | null,
  etaByStop: Map,              // stop UID -> StopEtaState
  vehicleInference: {
    status: 'hidden' | 'inferred' | 'stale' | 'invalid',
    fromStopId: String | null,
    toStopId: String | null,
    reason: String | null,
    observedAt: String | null
  },
  generation: Number,
  abortController: AbortController | null,
  detailLastOK: String | null,
  sweepStatus: 'idle' | 'loading' | 'ready' | 'error'
};
```

`routeDetailState` 只存在記憶體。開啟、切換路線或關閉時遞增 `generation`，並 abort 仍可取消的請求。每個 async 回應在改 state／DOM 前必須比較其開始時的 generation；不相符即丟棄。使用者點站時，`makeStopRequest(it, stop)` 必須 clone 原路線資料並只覆寫 `seq`、`stopId`、`stopName`，不得修改 `items` 內物件。這能防止「新站標題配上舊站 ETA」和關閉 A 後 A 的慢回應覆蓋新開 B 的競態。

第一版不增加 localStorage key，也不修改 `busboard.items.v1`、preferences、alarm、get-off、預設路線或 `busboard.eta-snapshot.v1` schema。詳情的 selected stop 是瀏覽狀態，重新整理頁面後應回到路線卡已儲存的站。既有 snapshot 可在 API 失敗時作本站回退，但其上限是 20 分鐘，並需清楚顯示快取時間。[8]

### 4.3 ETA 狀態、時間戳與 UI 行為

`eta_seq` 是單站的預報次序，顯示前必須排序；`eta` 可為 `null`，代表目前沒有可用 ETA，絕不等同 0 分鐘或已到站。`rmk_tc/sc/en` 必須保留，例如「原定班次」／`Scheduled Bus`、只限星期日或公眾假期等營運資訊。`data_timestamp` 是原始伺服器準備資料時間，頂層 `generated_timestamp` 是回應初次生成時間；兩者可供 freshness 判斷，但都不是車輛定位時間。[5] [6]

| 資料情況 | 頂部三格與站點行 | 推算 marker | 操作結果 |
| --- | --- | --- | --- |
| 首次讀取 | 顯示固定高度 skeleton 與「讀取即時到站資料」。 | 隱藏。 | 不啟動任何副作用。 |
| 新鮮成功且有 ETA | 最多顯示三格：分鐘、絕對時間、備註；`sched` 有獨立「原定班次」標示。 | 只可由嚴格推算規則決定。 | 更新該站自己的 state。 |
| 成功但無班次／`eta=null` | 顯示「暫時冇班次資料（可能已收車）」或「未有資料」。 | 隱藏。 | 不以假數字填充。 |
| API 失敗而本站 snapshot 未過期 | 以 ISO 重新計算尚餘分鐘，另顯示「網絡暫時中斷，按上次資料估算」及 cached 時間。 | 一律隱藏。 | 可提供本站「重新載入」。 |
| API 失敗且無有效 snapshot | 顯示「讀取失敗／連線超時」及「重新載入」。 | 隱藏。 | 保留時間線，不白屏。 |
| 資料超過約 2–3 分鐘 | 顯示「資料約 N 分鐘前」／「資料可能已過期」。 | 隱藏。 | 不標為「接近中」。 |
| 當日尾班已過 | 顯示「當日尾班已過」或「已收車」。 | 隱藏。 | 仍可選站查看服務狀態。 |

「接近中」只能在產品集中常數定義的門檻內（建議 ETA 小於 5 分鐘）而且資料新鮮時顯示。所有失敗、離線與過期文案均須同時表達資料來源與時間，不得讓使用者誤以為快取仍是即時值。

## 5. 途中巴士 ETA 推算：算法、誠實標籤與禁止用語

### 5.1 產品定位

途中 marker 是**資料視覺化的保守推算**，不是車輛追蹤功能。它只能表達「部分相鄰站 ETA 在時間上看起來一致」，無法證明兩個 ETA 屬於同一架車，也無法得知巴士在道路上的真實座標。第一版每個路線方向最多顯示一個 marker，且任何不確定都採「不顯示」而非提高視覺精確度。

所有可見及無障礙文案必須使用以下固定標示：

> **圖標旁標籤：**「推算中」  
> **輔助文字／tooltip／讀屏文字：**「按相鄰站 ETA 推算，並非巴士 GPS。」

以下詞語禁止用於 marker、圖例、`aria-label`、測試文案或宣傳文字：**「實時巴士位置」**、**「即時位置」**、**「GPS 追蹤」**、**「巴士目前位置」**、**「車輛座標」**。即使未來使用站點座標，也不可畫成車輛道路軌跡。站點座標僅供既有地圖／站點功能使用，不應參與這個 ETA marker 的定位。[6]

### 5.2 `deriveEstimatedSegments()` 的保守規則

建議實作純函式 `deriveEstimatedSegments(stops, etaByStop, now)`，輸出零或一筆：

```js
{
  fromSeq, toSeq,
  confidence: 'estimated',
  observedAt
}
```

函式應依下列順序篩選。任何一項不符合，該候選立即淘汰；無候選則回傳空陣列或 `hidden` 狀態。

1. **只比較相鄰站。** `toSeq === fromSeq + 1`；不可從不相鄰、單一站或缺站資料推論。
2. **資料必須同時新鮮且可比較。** 兩個站的資料均為非 stale、抓取時間距當下不超過 75 秒，並屬同一刷新批次或具有可比較的 `data_timestamp`。任一 API error、舊 snapshot 或資料過期均不合格。
3. **排除排班性預報。** 兩端最早的未過期 ETA 不可帶 `sched=true` 或 `Scheduled Bus`／「原定班次」備註。該備註是班次性質，不是車輛識別，但其不確定性足以排除 marker。[5]
4. **使用每站最早的有效未過期 ETA。** 解析 ISO 後，下游到站時間必須嚴格晚於上游到站時間；兩者差值必須介於 30 秒與 20 分鐘。倒置、同時、過大或無法解析時皆視為不一致。
5. **限制接近上游站的時點。** 上游 ETA 須落在「即將到達至未來 3 分鐘」內，才能顯示 marker；第一版放在兩站線段中點，不聲稱精確百分比或道路位置。
6. **衝突時不畫。** 多個候選時只可選離 `now` 最近的一個；若候選互相矛盾、方向／服務類型混合、站次不連續或完整性不足，回傳空結果。
7. **立即失效。** 75 秒後、換路線、換方向、資料變 stale、出現 scheduled、API error 或 ETA 倒置時，立即移除 marker，並將狀態改為 `hidden`、`stale` 或 `invalid`。

marker 隱藏時，服務狀態條應顯示可理解理由，例如「暫無足夠資料推算巴士位置」；若是舊資料，使用「資料可能已過期，未顯示 ETA 推算」。此處的「巴士位置」只能置於否定／限制句中，並同時說明是 ETA 推算，最佳做法仍是採上述固定輔助文案。

## 6. 詳細頁 UI 與互動規格

### 6.1 手機優先資訊架構

設計基準為 360–430 px 寬手機；在桌面以最大內容寬度限制顯示。資訊層級應保持穩定，ETA 更新不應令頁面大幅跳動。頁面由上至下依序如下。

| 區塊 | 必備內容與行為 | 無障礙／風險控制 |
| --- | --- | --- |
| Sticky 頂部導覽列 | 左側 44×44 px 返回按鈕，中央顯示如「KMB 74X」，右側只可放收藏或資訊。 | 返回名稱為「返回路線列表」；不放 GPS、鬧鐘快捷鍵。 |
| 路線摘要卡 | 方向「起點 → 終點」、站數、可取得的首班／尾班、官方全程車資；明確「對調方向」按鈕。 | 切換後載入新方向並把選站設為新方向首站；不混用舊方向站名和新 ETA。 |
| 目前顯示車站 | 標題固定「目前顯示車站」，展示繁中站名、站號及英文副名。 | 選站更新時只替換本區與時間線選中狀態。 |
| 三格 ETA 面板 | 固定欄寬與相同高度，依序為「即將到達／下一班／第三班」。每格可顯示大字分鐘、絕對時間與備註。 | 主 ETA 24–32 px、tabular numerals；無資料必須顯示文字，不能顯示 0。 |
| 非阻塞狀態條 | 「實時資料・剛更新」、「連線失敗・顯示上次資料」、「未有實時數據」與明確重試按鈕。 | 錯誤不覆蓋站點列表；重試只讀取資料。 |
| 全站時間線 | 標題「沿途車站列表（共 N 個站點）」，垂直主線、圓點、順序、繁中站名、英文／站號與可選 ETA 摘要。 | 每一行整體為 `<button>`，最小觸控高度 56 px；不可強迫頁面跳回頂部。 |
| ETA 推算 marker | 通過算法時畫在兩個站圓點之間，帶「推算中」與固定非 GPS 說明。 | 缺資料、過期、scheduled 或不一致時完全隱藏。 |

進入流程為：使用者按路線小卡主體中明確標示的「查看完整路線」控制；頁面先以快取站點與 skeleton render，再非阻塞更新 ETA；返回、Escape 與瀏覽器 Back 都會關閉 overlay 並回復原卡控制的焦點及列表捲動位置。overlay 開啟時需 lock 背景捲動、管理 focus、`aria-modal` 和標題；以 history state 支援 Back。`popstate` 只可關閉 overlay，避免再呼叫一次 `history.back()` 形成迴圈。

站點行的讀屏名稱可採「第 7 站 牛頭角下邨，未來約 8 分鐘，按兩下查看」。目前站用 `aria-current="true"` 並有「已選」文字；已過站不可只以灰色表示。ETA 摘要可用 `aria-live="polite"`，但不得逐秒播報倒數。鍵盤 Tab 順序至少涵蓋返回、方向、重新載入與每個站點行。

### 6.2 站點及三格 ETA 視覺狀態

| 狀態 | 時間線與 ETA 呈現 | 點擊結果 |
| --- | --- | --- |
| 後續站 | 正常主線／圓點、站名、可用 ETA 摘要。 | 設為 `selectedStopId`，更新頂部三格。 |
| 已過站 | muted 主線與文字、空心圓或勾號，另有「已過站」文字。 | 仍可選取查看可得資料。 |
| 目前觀察站 | accent 邊框／底色、實心圓點與「已選」。 | 不重複觸發副作用。 |
| 接近中 | 僅在新鮮 ETA 小於門檻時，顯示「接近中」及「約 N 分鐘」。 | 純資訊展示，不播聲、不震動。 |
| 無資料 | 「未有資料」及「暫無即時班次」。 | 仍可選取與手動重試。 |
| 資料過期 | 顯示舊值但附「資料約 N 分鐘前／可能已過期」warning。 | 不可標為接近中。 |
| 終點／尾班已過 | 終點標籤；必要時「當日尾班已過」。 | 仍可查看服務狀態。 |

快速連點時，最後一次選站必須勝出。新站先呈 loading，而非保留舊站 ETA；請求可取消、去重或提升選中站在 queue 中的優先級。若使用者在詳情開啟期間刪除目前路線，刪除 handler 必須先關閉詳情、abort loader，再執行現有 alarm/get-off 清理，避免已刪 route 的回應寫入 DOM。

## 7. 明暗主題、排版與可及性

詳細頁只能使用既有語意 CSS variables，不可在元件內硬編只適合深色模式的顏色。建議統一使用下列 token：`--bg`、`--surface`／`--card`、`--surfaceRaised`、`--textPrimary`／`--tx`、`--textSecondary`、`--border`、`--accent`、`--success`／`--approaching`、`--muted`／`--past`、`--warning`／`--stale`、`--error`。現有 `:root` 深色 token 與 `body.light` 覆寫是唯一主題切換入口。

| 面向 | 深色模式 | 光明模式 | 共通要求 |
| --- | --- | --- | --- |
| 頁面與卡片 | 深灰頁底、較亮灰色 surface、非純白主字。 | 近白頁底、白色 surface、深灰主字。 | 不可使用大面積純黑／純白對撞。 |
| 強調色 | 青綠或藍綠 accent 用於選中、焦點與可用狀態。 | 同色相 accent，調整明度以維持可讀性。 | 不能只靠顏色區分 selected、stale 或 error。 |
| 文字與數字 | 主文字最少 16 px；英文／站號 12–14 px。 | 同一資訊階層與文案。 | ETA 24–32 px，使用 tabular numerals，保障對比。 |
| 控制與觸控 | 高可見 focus ring、返回與行按鈕至少 44×44 px。 | 同一焦點與 hit target 規則。 | 360 px 不可水平捲動；行按鈕建議最少 56 px 高。 |
| 動畫 | 避免 marker／ETA 大幅位移或閃爍。 | 同左。 | `prefers-reduced-motion` 時只可用短暫色／邊框變化。 |

樣式插入點建議在 `index.html` 既有 board／sheet CSS 區段後新增 `.route-detail`、`.route-detail__header`、`.route-detail__summary`、`.route-detail__eta-panel`、`.stop-timeline`、`.stop-row`、`.stop-row.is-selected`、`.detail-status`、`.detail-eta--stale`、`.eta-estimate` 等 class。以 `@media (min-width: 720px)` 設定內容最大寬度；同時補 `body.font-large` 的 timeline 與按鈕字級。任何站名、備註或 API 字串插入 DOM 前均使用既有 `esc()`。

## 8. 分段實作計畫與每段停點

目前基線是 `main` 的 `caaf740`。開始前先建立保護 tag，例如 `pre-route-detail-2026-09-15`，並確認研究文件仍為未追蹤文件時不要誤加進 feature commit。每段完成後必須可單獨 build、可執行靜態檢查與相應測試；不可將 detail、PWA、鬧鐘改動混入不可分割的大提交。

| 切片 | 建議提交訊息 | 主要修改檔案 | 本段工作 | **停點／通過門檻** | 可獨立回滾範圍 |
| --- | --- | --- | --- | --- | --- |
| A：測試基線 | `test: add static Playwright smoke harness` | `package.json`、lockfile、`playwright.config.mjs`、`tests/smoke.spec.mjs`，必要時 `tests/server.mjs` | 建 Node static server 與 Playwright Chromium smoke；首頁無 page error、主板可 render。 | 不改任何產品 UI／PWA 行為；`npm test` 和 smoke 綠燈。 | 移除測試工具即可。 |
| B：資料與快取核心 | `feat(route-detail): add variant stop cache and detail data state` | `index.html`、`tests/route-detail-core.spec.mjs` | 加入 `routeVariantKey()`、`getRouteStopsCached()`、in-flight promise、暫態 state、immutable `makeStopRequest()`、generation guard；現有 map／get-off 改走 helper。 | KMB／CTB／GMB 各方向與特別班次 fixture 通過；成功才 cache，abort 不留 error cache；尚未公開詳情 UI。 | 撤回 cache／state，不傷主板、地圖和 GPS。 |
| C：可存取全畫面殼層 | `feat(route-detail): add accessible full-screen route timeline` | `index.html`、`tests/route-detail-ui.spec.mjs` | 加入 hidden detail root、entry control、overlay、focus／scroll／history 管理與完整站點時間線。 | 任一路線可進入、返回／Escape／Back 可關閉；站點完整且可鍵盤點選；尚未加入全線 ETA sweep。 | 撤回 entry／overlay，卡片回到原行為。 |
| D：逐站 ETA 與推算 | `feat(route-detail): load per-stop ETA with safe fallback` | `index.html`、`tests/route-detail-eta.spec.mjs`、`tests/fixtures/*.json`、`tests/alarm-isolation.spec.mjs` | 重用 parser 和 snapshot；KMB 一次 fetch grouping；CTB／GMB queue；selected 優先；stale/error UI；`deriveEstimatedSegments()`。 | 三格 ETA、per-stop fallback、競態取消和所有推算閘門通過；alarm isolation 斷言為零。 | 可單獨移除 queue／marker，不改 alarm 主鏈。 |
| E：PWA、文件與 CI gate | `chore(pwa): gate Pages deployment and version detail shell` | `sw.js`、`README.md`、`.github/workflows/pages.yml`、`CHANGELOG.md`，必要時 shared helper | 提升 shell 名稱、更新 precache、加 test→deploy gate、建立 `_site/` staging、更新交接與 release record。 | Pages 只在 test 成功後部署；`_site` 不含依賴／測試；離線首頁與 `gov.hk` 不快取均通過。 | 可獨立修正／回退 SW、CI、文件。 |

### 8.1 檔案級接駁點

在 `index.html` 中，`routeDetailState` 應置於 state 區並在 `shell()` 前宣告。於 `#board` 之後、sheet／screensaver 之前加入初始為 `hidden` 的 `#routeDetail` root，使用單一 `renderRouteDetail()` 只更新該 root。不可在選站時重跑 `shell()` 或重繪主板。`shell()` 僅負責為路線卡提供明確的 `data-detail-id` 進入控制及 listener；卡片中的 map、alarm、get-off、編輯站按鈕仍使用各自 listener 與 `stopPropagation()`，不可把含多個按鈕的整張卡變成不明確 click target。

KMB adapter 應先抽出可重用的純函式，例如 `parseKmbRouteEta(rows, request)`；既有 `etaKMB()` 與詳情的 route ETA group 均使用它，避免產生第二個 parser。CTB／GMB 一律維持現有 `fetchETA()`／adapter；如需額外參數，使用向後相容的 `fetchETA(it, { limit: 4 })`，保留原預設輸出。`refresh()` 在 detail 開啟時可繼續為主板與既有 alarm 運作，但絕不可刪除 detail root 或覆寫 `routeDetailState`。

## 9. 自動化、靜態檢查與人工驗收

### 9.1 測試資產與 CI 基線

| 測試資產 | 核心責任 |
| --- | --- |
| `package.json`／lockfile | 鎖定 `@playwright/test`，提供 `test`、`test:ui`、`test:syntax` scripts；CI 使用 `npm ci`。 |
| `playwright.config.mjs` | Chromium、可覆寫 localhost baseURL、失敗時 trace／screenshot、single worker；每案使用獨立 browser context。 |
| `tests/fixtures/` | KMB／CTB／GMB 的成功、無班次、error、scheduled、時間戳 fixture；不得使用真實使用者 localStorage 或不穩定 live data。 |
| `route-detail-ui.spec.mjs` | entry、站點時間線、主題、鍵盤、focus、history 和行動 viewport。 |
| `route-detail-eta.spec.mjs` | parser reuse、selected 優先、per-stop fallback、abort／generation、KMB request count 與推算規則。 |
| `alarm-isolation.spec.mjs` | stub Notification、geolocation、SW `postMessage`、audio、vibrate；檢查詳情操作後計數全為零，且 alarm storage 不變。 |

測試中的官方 API 必須以 `page.route()` mock，避免測試結果依賴即時網絡和外部服務變動。部分測試以 `serviceWorkers: 'block'` 排除干擾；另保留至少一個允許 Service Worker 的 PWA smoke。KMB 全線 sweep 需對 fetch count 斷言同一條 route ETA 僅請求一次。

### 9.2 必跑自動測試案例

| 類別 | 必須驗證的情況 |
| --- | --- |
| 進入與時間線 | 注入儲存 KMB route 與 dark preference；首頁完成後進入詳情；標題、方向、站數、全數 station button 與預設 selected stop 正確。 |
| 三格 ETA | fixture 的 ETA 依排序取前三筆；`rmk`／scheduled 樣式正確；CTB／GMB 的 immutable request 帶正確 `stopId`、`seq`、方向。 |
| 選站與不變性 | 點另一站後頂部先 loading、後只顯示新站 ETA；`items`、`busboard.items.v1` 和原卡選站完全不變。 |
| 回退與錯誤 | timeout／500 + 20 分鐘內本站 snapshot 時顯示 stale、以 ISO 重算分鐘與 cached 時間；超過 20 分鐘時只顯示錯誤。 |
| 競態 | 慢 route A、關閉後立刻開 route B；A 回應後畫面仍只包含 B；刪除開啟中的 route 不產生 uncaught error。 |
| 主題與可及性 | `body.light`、`font-large`、390×844 mobile；對比、selected 可辨識、無橫向捲動；Escape、返回與 browser Back 均使焦點回到原 detail button。 |
| 推算誠信 | 只有相鄰、新鮮、非 scheduled、ETA 正向差 30 秒–20 分鐘且上游 ≤3 分鐘時出現一個 marker；stale、scheduled、倒置、過期及單站 fixture 均無 marker；文字含「非 GPS」。 |
| 副作用隔離 | 進入、選站、全線重試均不請求通知、不播放音效、不震動、不讀 GPS、不傳 SW 訊息，且 `alarms`、`alarmPlans`、`alarmSessions`、`alarmSeen` 不變；另回歸既有 armed card alarm 行為。 |

最少靜態檢查指令如下。它把 inline script 抽出後交由 Node 解析，避免只檢查外部檔案。

```bash
# 在 repository root 執行
python3 - <<'PY'
from pathlib import Path
s = Path('index.html').read_text()
Path('/tmp/buspulse-inline.js').write_text(s.split('<script>', 1)[1].split('</script>', 1)[0])
PY
node --check /tmp/buspulse-inline.js
node --check sw.js
npm ci
npx playwright install --with-deps chromium
npm test
git diff --check
git status --short
```

### 9.3 發佈前人工瀏覽器驗收

自動 mock 不足以驗證 PWA lifecycle。每次重大發布至少在 Chrome Android（含已安裝 PWA）、Safari iOS（已加至主畫面）及 desktop Chrome 各測一次。覆蓋首次載入、從舊 cache 更新、深／淺色、大字、慢網絡、offline、詳情返回、原卡 map、GPS get-off、鬧鐘開關、通知權限、screen saver 及主板 refresh。特別確認手機安全區不被 sticky header 遮住、時間線可順暢捲動、所有 marker 皆有非 GPS 標示。既有 PWA 背景執行和通知不保證在鎖屏必達，驗收紀錄不可把它描述成保證。[10]

## 10. GitHub Pages 部署、PWA 快取與回滾

### 10.1 PWA shell 與部署 gate

只要 `index.html` 或新增 shared detail 靜態檔納入發布，`sw.js` 的 `SHELL` 名稱必須由現行 `buspulse-hk-shell-v30-redesigned-app-icon` 單調遞增，例如：

```text
buspulse-hk-shell-v31-route-detail
```

若另抽出 `route-detail-core.js`，必須加入 `FILES` precache；若 detail logic 留在 `index.html`，仍須提升 cache 名稱以強制已安裝 PWA 取得新 shell。維持 `skipWaiting()`、`clients.claim()` 和 activate 時清除非當前 shell 的行為。最重要的是保留 Service Worker 對 `gov.hk` 的略過規則；ETA 不得由 SW runtime cache，否則舊到站資料會被誤當作即時資料。[11]

GitHub Actions workflow 應拆成 `test` 與 `deploy`：

1. `test` job checkout、設定 Node LTS、執行 `npm ci`、安裝 Chromium、啟動 static server、執行 syntax／Playwright／`git diff --check`；失敗時上傳 Playwright report。
2. `deploy` job 設 `needs: test`，只有測試成功後才執行現有 GitHub Pages configure、upload 與 deploy。
3. 不應直接 upload `.`。先建立 `_site/`，以 `rsync -a --delete` 排除 `.git`、`.github`、`node_modules`、`tests`、`playwright-report`、`test-results`、`package*.json` 和研究文件，再 upload `_site/`。
4. CI 必須斷言 `_site/index.html`、`_site/sw.js`、`_site/manifest.json`、icons、`fare-index.json`、`place-index.json` 存在；避免因 staging 規則錯誤發佈殘缺 PWA。
5. 成功部署後，在 `CHANGELOG.md` 記錄 Git SHA、Pages URL、SW shell 版本及三平台人工驗收結果。

正式發布順序是 feature branch 全測試 → PR／review（重點檢查 `sw.js`、alarm 區、localStorage keys）→ merge `main` → 觀察 Pages 的 test 與 deploy jobs → 以公開 Pages 無痕頁驗證版本、更新一次、首頁、offline fallback 和 API failure UI → 驗證已安裝 PWA 更新。現行部署 workflow 可作接駁基礎。[12]

### 10.2 可回滾的提交與 runbook

每個切片 commit hash 都應寫入 release note。若功能異常，禁止 force-push 或重寫公開 `main`；應由最新 main 建立 rollback branch，再由新至舊 revert 對應 commit。以下命令中的 hash 必須替換成實際提交：

```bash
git fetch origin
git switch -c rollback/route-detail origin/main
# 依實際 hash 由新至舊撤回；只撤 ETA sweep 時先只撤 commit-4。
git revert --no-commit <commit-5> <commit-4> <commit-3> <commit-2>
npm test
git diff --check
git commit -m "revert: remove route detail release"
git push origin HEAD:main
```

推送後會觸發 Pages workflow。必須確認公開部署使用 revert SHA，再以無痕瀏覽器和曾安裝壞版的 PWA 驗證主板、鬧鐘與 offline 首頁。若問題僅限 ETA sweep，優先只撤切片 D；若問題僅限 CI／artifact staging，修正或撤切片 E，避免不必要移除穩定 UI。

**PWA 快取緊急回滾不可只重新部署舊檔。** 如果已恢復的 `index.html` 正確、但裝置仍載入壞 shell，必須建立新的 rollback commit，保留恢復後檔案並再提升 `SHELL`，例如 `buspulse-hk-shell-v32-rollback-route-detail`。如此新 Service Worker 才會安裝「舊功能內容的新 shell」，並在 activate 時清理壞 cache。`CHANGELOG.md` 必須記錄 source SHA、rollback shell 名稱、部署 run URL、驗證裝置與遺留問題。[11] [12]

## 11. 接手工程師的合併前檢查表

| 類別 | 必須成立 |
| --- | --- |
| 資料正確性 | 各公司、方向、特別班次使用正確 variant key；KMB 以 `(route, direction, serviceType, seq)` join；所有 detail ETA 來自既有 normalizer；絕無跨站 ETA 借用。 |
| 快取與競態 | route-stop 僅成功後 cache；in-flight promise 可清理；detail 請求可取消；generation guard 有效；snapshot 僅同站且 20 分鐘內有效。 |
| ETA 誠實性 | `eta=null`、empty、stale、offline、error、尾班已過均可分辨；資料時間可見；不以 `0`、`—` 或假值偽裝正常 ETA。 |
| 推算誠信 | 僅相鄰、新鮮、非 scheduled、一致 ETA 顯示至多一個 marker；固定「推算中」與「並非巴士 GPS」文案；任何不確定均不畫。 |
| 副作用隔離 | 詳情操作零通知、零聲音、零震動、零 GPS、零 Service Worker message、零 alarm plan／timer／storage mutation。 |
| UI 與可及性 | 三格 ETA 高度穩定；selected／past／stale 不只靠色彩；明暗／大字／鍵盤／Escape／Back／手機安全區通過；所有控制至少 44×44 px。 |
| PWA 與部署 | 新 shell version、`gov.hk` 不 cache、offline shell 可用、CI test 先於 deploy、`_site` 無測試與依賴檔。 |
| 回滾 | 已有 pre-release tag、切片 hash、rollback branch 流程及 PWA shell 緊急回滾方案；至少在 staging 或實機演練一次。 |

## 12. 主要風險與決策紀錄

| 風險 | 為何會發生 | 已定決策／緩解方式 |
| --- | --- | --- |
| 將 ETA 誤解為 GPS | 官方資料沒有 vehicle ID 或車輛位置欄位。 | 限制為一個保守 marker，使用固定非 GPS 文案與嚴格資料閘門。 |
| Route ETA 沒有 stop ID | 回應只有方向、站序與 ETA。 | 每日 route-stop join；不可永久硬編 `seq` 或站名。 |
| 多 service type／方向混用 | 共用站、特別班次或 adapter key 不完整時會發生。 | 以完整 variant key 隔離；fixtures 覆蓋方向與特別班次。 |
| 舊資料被當即時 | 網絡失敗時 snapshot 或 PWA cache 容易造成誤導。 | ETA snapshot 只限同站 20 分鐘；有 stale 時間標籤；SW 不 cache `gov.hk`。 |
| 選站競態 | 使用者快速點選、關頁或換路線。 | AbortController、generation guard、最後選站勝出與 immutable request。 |
| 詳情意外影響鬧鐘／GPS | 現有 `refresh()` 和 route card 含 alarm、GPS side effects。 | detail path 與主板 refresh 隔離；用專屬 alarm-isolation 測試強制驗證。 |
| 發布後已安裝 PWA 停留舊版 | App shell cache 不會因同名 cache 自動安全更新。 | 每次 shell 內容發布、包括 rollback，均使用新的單調 `SHELL` 名稱。 |

---

## References

[1]: https://data.gov.hk/en-data/dataset/hk-td-tis_21-etakmb "DATA.GOV.HK：九巴及龍運巴士路線實時到站數據"

[2]: https://data.gov.hk/en-data/dataset/hk-td-tis_21-etakmb/resource/11be6340-8ef1-42d2-a1e1-45bec949a9b1 "Official KMB Route ETA Data API"

[3]: https://data.gov.hk/en-data/dataset/hk-td-tis_21-etakmb/resource/2dda0e97-fc4d-449c-bb98-a17228742eb4 "Official KMB Route-Stop Data API"

[4]: https://data.gov.hk/en-data/dataset/hk-td-tis_21-etakmb/resource/12185102-718d-4d03-bfd7-b9ecf760aee2 "Official KMB Stop ETA Data API"

[5]: https://data.etabus.gov.hk/datagovhk/kmb_eta_api_specification.pdf "KMB ETA API Specification v1.05"

[6]: https://data.etabus.gov.hk/datagovhk/kmb_eta_data_dictionary.pdf "KMB ETA Data Dictionary v1.02"

[7]: https://data.gov.hk/en-data/dataset/hk-td-tis_21-etakmb/resource/2ea2591f-67e7-488d-83de-96ed48def51e "Official KMB ETA Data API"

[8]: https://github.com/cw91020251212/gang-baa-im-si-buspulse-hk/blob/main/index.html "BusPulse HK 主應用程式：adapter、儲存、ETA cache、鬧鐘與 refresh loop"

[9]: https://github.com/cw91020251212/gang-baa-im-si-buspulse-hk/blob/main/AI_HANDOFF.md "BusPulse HK 工程交接與官方資料限制"

[10]: https://github.com/cw91020251212/gang-baa-im-si-buspulse-hk/blob/main/README.md "BusPulse HK README：本地鬧鐘、PWA 與私隱限制"

[11]: https://github.com/cw91020251212/gang-baa-im-si-buspulse-hk/blob/main/sw.js "BusPulse HK Service Worker：app-shell cache 與本地通知"

[12]: https://github.com/cw91020251212/gang-baa-im-si-buspulse-hk/blob/main/.github/workflows/pages.yml "BusPulse HK GitHub Pages 部署 workflow"
