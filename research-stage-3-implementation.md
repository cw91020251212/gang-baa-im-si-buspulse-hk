# BusPulse HK 路線詳細頁：第三階段檔案級分段實作方案

**版本：** 0.1（研究方案；未修改產品程式）  
**日期：** 2026-09-15  
**作者：** Manus AI  
**研究基線：** `main` 的 `caaf740`；工作目錄另有未追蹤的 `ROUTE_DETAIL_RESEARCH.md`，本方案不會將其納入日後功能提交。  
**範圍：** 為「由儲存路線卡進入全畫面詳細頁、列出全線車站、逐站 ETA 三格，以及有限條件下的 ETA 推算途中位置」制定可逐提交、可測試、可回滾的實作計畫。

## 1. 結論與實作邊界

第一版應維持目前的**單頁純前端 PWA**，而不是引入伺服器、帳戶、推送服務或背景 API 代理。詳細頁是主畫面的暫態檢視：它讀取既有已儲存路線、重用公司 API adapter、ETA normalizer、`routeStopsCache`、`ETA_CACHE_KEY` 和現有深／淺色 CSS variables；它不可把使用者點選的詳細頁站點寫回路線卡，亦不可啟動 GPS、到站鬧鐘、聲音、震動或通知。這個界線可保留現有「鬧鐘只在使用者明確按路線卡鈴鐺後才運作」的產品承諾。[1] [2]

現有 `index.html` 已經集中 HTML、CSS 和 JavaScript，並已提供各公司的站點清單函式、統一 ETA 回傳形狀、短期 localStorage ETA 回退，以及路線站點 Map；因此最安全的路徑是**在同一檔案以小型、具名稱的 detail module 區段接駁既有能力**。不要另寫第二組 API parser，也不要把詳細頁的請求納入主板 `refresh()` 的 alarm pipeline。`sw.js` 只需要在發佈切片中升級 shell cache 名稱；它不應快取 `gov.hk` ETA 回應，亦不應加入任何詳細頁通知處理。[1] [3]

> **推算位置的限制：** 官方 ETA 是到站預報，不是普遍可用的巴士 GPS。詳情頁只可在相鄰站、有新鮮且非預定班次 ETA、並通過一致性閘門時，畫出「按 ETA 推算」的圖標；缺一項即不畫。它不能使用「實時巴士位置」或等同語句。[2]

## 2. 已核實的現況與對詳細頁的影響

| 檔案／範圍 | 已存在能力 | 對實作的決定 |
| --- | --- | --- |
| `index.html`：CSS、`shell()`、`refresh()` | 深色 token 位於 `:root`，淺色由 `body.light` 覆寫；路線卡以 `shell()` 字串渲染；主板每 25 秒輪詢。 | 詳細頁必須使用同一組 `var(--bg)`、`var(--card)`、`var(--tx)` 等 token，並在 `shell()` 加入明確進入控制及 event listener；不要把詳情 DOM 重繪進 `board`。 |
| `index.html`：`routeStops()`、`stopsKMB/CTB/GMB()` | 三間公司的站點資料已正規化為 `{seq,id,name,lat,lng}`。CTB stop 名稱／座標逐站取得。 | 以 detail route-variant key 包裝並重用此鏈；成功資料才存 cache；取消或失敗不可留半截陣列。 |
| `index.html`：`etaKMB/CTB/GMB()`、`fetchETA()` | 已正規化為 `{etas:[{iso,min,rmk,sched}],err}`，並已按 ETA 排序、刪除過期列、限制四列。 | 詳細頁建構暫態 stop request 並呼叫同一 parser；畫面只取前三列。不得為詳情頁重新解析原始 JSON。 |
| `index.html`：`etaSnapshots`／`cachedEta()` | `busboard.eta-snapshot.v1` 最長 20 分鐘、用 ISO 重新倒數，主板 API 失敗才顯示 stale。 | 詳情頁沿用同一 format 和過期上限，但每一站以該站自己的 `uid` 查找；不可用其他站的 ETA 填補。 |
| `index.html`：alarm、GPS、通知程式 | `refresh()` 會 `scheduleAlarmFallbacks()`、`checkAlarms()`；`toggleAlarm()` 會要求通知權限；get-off 會取得 GPS。 | detail loader 只可執行資料讀取與 DOM 更新。不得呼叫上述函式、`requestNotifications()`、`ringBell()`、`navigator.geolocation` 或 Service Worker `postMessage()`。 |
| `sw.js` | 預快取 app shell、same-origin network-first 回退、忽略 `gov.hk` 請求，以及只處理本地到站通知。 | 詳情頁沒有額外 API runtime cache；發布時用新 `SHELL` 名稱迫使新版 app shell 更新，維持 offline fallback。 |
| `README.md` | 已準確說明本地 ETA 鬧鐘、瀏覽器背景限制、PWA 與 localStorage。 | 需加入詳情頁的 ETA／推算非 GPS 限制、測試指令與發佈流程，不能改寫成保證背景或定位服務。 |
| 測試目錄及設定 | 沒有 `package.json`、Playwright、Jest、Cypress、`tests/` 或現成測試檔。 | 建立最小 Node + Playwright 基線，同時將 CI test job 置於 Pages upload 之前；不可聲稱現有自動測試已覆蓋此功能。 |
| `.github/workflows/pages.yml` | `main` push 直接 upload `.` 後 deploy；目前沒有 test job。 | 引入獨立 test job 及排除 `node_modules`／`tests` 的 staging site，避免把依賴和測試輸出部署到 Pages。 |

## 3. 目標狀態、資料生命週期與不變條件

### 3.1 詳細頁暫態狀態

在 `index.html` 的 state 區、但在 `shell()` 前，新增一個只存記憶體的 `routeDetailState`。建議欄位為：

| 欄位 | 意義 | 保存位置／生命週期 |
| --- | --- | --- |
| `open`、`routeId`、`variantKey` | 是否開啟及哪一條儲存路線／路線變體。 | 記憶體；關閉頁面即清除。 |
| `stops`、`stopsStatus`、`stopsError` | 成功載入的完整站點、loading／ready／error 狀態及可顯示錯誤。 | 記憶體；成功後同時由 `routeStopsCache` 重用。 |
| `selectedSeq`、`selectedStopId` | 使用者目前查看的站；預設為現有路線卡上車站。 | 記憶體；**不可**更新 `items`、`stopName`、`stopId` 或 `seq`。 |
| `etaByStop` | `Map<stopUid, {status, etas, error, stale, cachedAt, fetchedAt}>`。 | 記憶體；資料離開頁面便釋放。新鮮 ETA 可沿用既有 ETA snapshot 規則。 |
| `generation`、`abortController` | 開啟、換路線或關閉時遞增／abort；每個 async 回應先比對 generation。 | 記憶體；避免舊請求覆蓋剛開啟的另一條路線。 |
| `detailLastOK`、`sweepStatus` | 詳細頁自己的更新時間與背景逐站讀取進度。 | 記憶體；不能改寫主板 `lastOK` 或頂部健康圓點。 |

`localStorage` **第一版不增加 key**。現有 `busboard.items.v1`、`busboard.preferences.v1`、alarm keys、get-off key、預設路線 key 和 `busboard.eta-snapshot.v1` 均保持 schema 不變。詳情頁選中站是瀏覽狀態而非使用者設定，刷新後回到卡片的已儲存站。現有備份 payload 也無須改版，故不需要 migration；這可避免把暫態、可能過期的全線 ETA 寫進備份或無限成長 localStorage。[1]

### 3.2 路線／站點 key 與 `routeStopsCache`

目前 `uid(it)` 包含 `stopId` 或 `seq`，適合一張路線卡和其 ETA snapshot，但不適合以同一路線不同上車站共用全線站點。新增純函式 `routeVariantKey(it)`，應只由公司及路線變體識別欄位構成：KMB 使用 `co|route|dir|service_type`，CTB 使用 `co|route|dir|bound`，GMB 使用 `co|route_id|route_seq`。不可用站名作 key。

將 `routeStopsCache` 的使用統一為 `getRouteStopsCached(it, {signal})`：先查 `routeVariantKey`；未命中時呼叫一次 `routeStops(it)`；驗證結果是排序後且 `seq`、`id` 唯一的完整陣列；成功才寫入 Map。並加一個同行中的 promise Map，讓「開啟詳細頁」與「開啟地圖／落車設定」不會對同一變體重複請求。拒絕或 abort 時必須刪除 promise，而不是永久 cache error。把現有 `openGetoffSetup()`、地圖使用點及 `updateGetoff()` 改為此 helper 或以 helper 回填相容 key，確保既有 GPS 功能仍取得相同站點清單。

此轉換要特別回歸 KMB 的 `service_type`、CTB inbound／outbound、GMB 的 `route_id` 與 `route_seq`；省略任何一項都可能令不同特別班次或方向錯共用車站。

### 3.3 詳情頁 ETA 請求次序

點入詳細頁後立即顯示 skeleton，先取得站點清單；完成後以目前卡片站作 `selectedStopRequest`，優先取得該站 ETA。這條請求完成後，才在背景掃描其他車站，並以固定併發上限三條（CTB／GMB）及可取消 queue 進行。使用者改選站時，把該站提升到 queue 頂部；關閉或換路線時 abort 未開始及可中斷的請求。

KMB 是例外：現有 `etaKMB()` 每次已讀取相同 route ETA endpoint 後再按 `seq`／`dir` 過濾。先在不改輸出的情況下抽出 `parseKmbRouteEta(rows, request)`；詳情頁每次 sweep 只 fetch 一次該 route response，按 `seq` group 後交給同一 parser，避免 N 個站重複讀同一 endpoint。CTB 和 GMB 維持每站 endpoint，但仍走既有 `etaCTB()`／`etaGMB()` normalizer。所有路徑必須保留 12 秒 timeout、`cache:'no-store'`、過期列過濾、排序，以及最多四筆內部資料；視覺卡只顯示前三筆。[1]

## 4. 檔案級分段實作方案

每個切片都必須可獨立 build、`node --check`、`git diff --check` 和執行其已存在的測試。不要把未追蹤研究文件意外 `git add`；提交前先檢查 `git status --short`。

| 切片 | 目的與驗收結果 | 修改檔案 | 主要內容及風險控制 |
| --- | --- | --- | --- |
| A：測試基線 | 在未改產品行為下有可重複的本機 browser smoke test。 | 新增 `package.json`、`package-lock.json`、`playwright.config.mjs`、`tests/smoke.spec.mjs`；必要時新增極小 `tests/server.mjs`。 | 使用 Node static server 提供 repo root，Playwright Chromium 開啟首頁並驗證無 page error、主板可渲染。此切片不可更新 PWA 或 UI。若 CI server port／baseURL 固定，必須可由環境覆寫。 |
| B：資料／快取核心 | 建立變體 key、共同站點 cache、暫態 detail state 與可取消 loader，仍未公開 UI。 | `index.html`；新增 `tests/route-detail-core.spec.mjs`。 | 加入 `routeVariantKey()`、`getRouteStopsCached()`、detail state、immutable `makeStopRequest(it, stop)`、generation guard。把既有 get-off／地圖讀站改走 helper，先以瀏覽器測試驗證無回歸。成功才 cache；每一公司方向及特別班次有 fixture。 |
| C：可存取的全畫面殼層 | 由路線卡進入、返回、Escape、Back 可關閉的完整詳細頁及全站時間線。 | `index.html`、`tests/route-detail-ui.spec.mjs`。 | 加入 CSS、固定 `#routeDetail` overlay、焦點管理和 `aria-modal`／標題；在 `shell()` 加入明確 `data-detail-id` 控制及 listener。卡片其餘按鈕仍各自運作且 `stopPropagation()`；不以整張含按鈕的 card 作不明確 click target。啟動時 push 一個 history state；`popstate` 只關閉 overlay，不重載主板。 |
| D：逐站 ETA、回退與推算標記 | 選中站即時三格 ETA、背景逐站狀態、可靠的 stale／error 顯示，以及被嚴格閘門限制的推算標記。 | `index.html`、`tests/route-detail-eta.spec.mjs`、`tests/fixtures/*.json`。 | 重用 parser、現有 snapshot 和 UI ETA formatter；加入 KMB 一次 fetch grouping、CTB／GMB concurrency queue、abort／generation。新增 `deriveEstimatedSegments()` 純函式及 unit cases。此切片不得接到 `refresh()` alarm calls。 |
| E：PWA、文件及 CI gate | 令新檔與新 shell 正確更新、文件可交接、Pages 只在 test 成功後部署。 | `sw.js`、`README.md`、`.github/workflows/pages.yml`、`CHANGELOG.md`；如 B 抽出 shared helper，加入 `route-detail-core.js` 至 precache。 | 遞增 `SHELL`（例如由 `v30` 至 `v31-route-detail`），明列新增 static helper；workflow 加 test job、deploy `needs: test` 和 staging directory。README 寫清推算限制、local-only 行為及 test／rollback。 |

### 4.1 `index.html` 的具體插入點

**CSS（現有 `<style>`）：** 在 board／sheet 區段後加入 `.route-detail`、`.route-detail__header`、`.route-detail__summary`、`.route-detail__eta-panel`、`.stop-timeline`、`.stop-row`、`.stop-row.is-selected`、`.detail-status`、`.detail-eta--stale`、`.eta-estimate` 等類別。所有背景、邊框和文字必須取現有 variable；深色與 `body.light` 只寫必要衍生規則。用 `@media (min-width: 720px)` 限制內容最大闊度，手機保持全螢幕；`body.font-large` 補充 time line 和 button 字級規則；`prefers-reduced-motion` 移除任何 marker animation。不得以硬編深色 `#17233a` 製造淺色模式對比失敗。

**HTML（`#board` 之後、sheet／screensaver 之前）：** 新增一個初始 `hidden` 的 detail root。其內容由一個 `renderRouteDetail()` 集中產生：header 有返回按鈕、路線／方向、站數和「ETA 推算，非 GPS」簡述；選中站 summary 顯示三格 ETA；timeline 以 `button` 表示每一站，帶 `aria-current="true"`；獨立的 loading、empty、stale 和 error 元件讓 screen reader 可得知狀態。不要從 API 直接插入未 escape 的站名或備註，沿用 `esc()`。

**進入／退出：** `openRouteDetail(it)` 先用 `uid(it)` 找已儲存 item，設定暫態 state、鎖住背景 scroll、開啟 overlay、focus 返回鈕並載入站點。`closeRouteDetail({fromPopstate})` abort、移除 scroll lock、復原先前 card 的 focus，清空暫態 selection；只有非 popstate 的退出才呼叫 `history.back()` 或安全地 replace state。必須避免 `popstate` 觸發 second `history.back()` 的迴圈。Card 的 map、alarm、get-off、編輯站按鈕保持原 listener；詳細頁本身不含上述控制。

**API／parser：** `makeStopRequest` 必須 clone `it` 並只覆寫 `seq`、`stopId`、`stopName`；不得改動 `items` 內 object。為避免 KMB 詳情與現有主板邏輯分歧，抽出純的 KMB row normalizer，令 `etaKMB()` 與 detail group 都呼叫它。CTB／GMB 亦只能使用既有 `fetchETA()`／adapter，必要時讓 `fetchETA(it, {limit: 4})` 接收可選參數但維持預設輸出不變。

**重繪界線：** `renderRouteDetail()` 只更新 detail root。主板 `shell()` 不應因選站而重跑；detail 打開時既有 `refresh()` 仍可更新主板與 alarm，但它不可刪除 detail root 或覆寫 `routeDetailState`。若使用者在 settings 刪除目前詳情路線，刪除 handler 必須先 `closeRouteDetail()`，再進行既有 alarm／get-off 清理，避免 loader 對已刪 item 寫 DOM。

### 4.2 ETA 顯示、失敗回退與途中推算的狀態矩陣

| 情況 | 選中站頂部與該站 row | 其他站 row | 推算 marker | alarm／GPS 行為 |
| --- | --- | --- | --- | --- |
| 首次讀取 | skeleton 與「讀取即時到站資料」。 | 逐站 skeleton，不把選中站結果複製過去。 | 不畫。 | 完全不觸發。 |
| 新鮮 API 成功且有資料 | 最多三格、分鐘／時間／備註，沿用 `sched` 樣式。 | 更新各自 ETA 摘要與 fetched time。 | 僅通過下述所有條件才畫。 | 完全不觸發。 |
| API 成功但無班次 | 顯示「暫時冇班次資料（可能已收車）」。 | 同樣各站獨立顯示。 | 不畫。 | 完全不觸發。 |
| API timeout／HTTP／parser error，且本站 snapshot 未過期 | 顯示 ISO 本地重新倒數，加「網絡暫時中斷，按上次資料估算」與 cached 時間。 | 不影響已有新鮮站；各站各自決定。 | 一律不畫，因 stale。 | 不以 detail cache 安排或檢查 alarm。 |
| API error 且本站無 snapshot 或超過 20 分鐘 | 清楚顯示「讀取失敗／連線超時」及「重試」；不可顯示 `—` 為正常班次。 | 同上。 | 不畫。 | 完全不觸發。 |
| 使用者換站／關閉／刪路線 | 新 generation 的結果才可畫；舊 response 忽略。 | queue abort／清空。 | 清除。 | 完全不觸發。 |

詳情頁的「重試」只重試該站或使用者明確要求的全線掃描。它不呼叫主板 `refresh({manual:true})`，因此不會讓卡片 loading icon、`lastOK` 或 alarm fallback 產生副作用。若希望主板和詳情同步，應由主板取得的相同站 snapshot 被讀取，而不是讓詳情直接操作 `latestResults`。

### 4.3 ETA 推算 marker 的保守算法

`deriveEstimatedSegments(stops, etaByStop, now)` 只接受正規化資料，傳回零至一個 `{fromSeq,toSeq,confidence:'estimated',observedAt}`。第一版規則如下：

1. 只考慮相鄰的有效站點對；兩站 ETA 資料均需在 75 秒內取得、非 `stale`、非 `sched`，且有可解析 ISO。
2. 取每站最早的未過期 ETA。下游站 ETA 必須晚於上游 ETA，差值介乎 30 秒至 20 分鐘；超出即視作不可比。
3. 上游 ETA 必須落在「即將到達至 3 分鐘內」，才可把圖標放在兩站正中；不嘗試由不相鄰、單一 ETA 或舊資料推斷位置。
4. 有多個候選時只保留距離現在最近的一個；候選相互矛盾、時間倒置、座標／站次不連續時回傳空陣列。
5. UI 文案固定為「按相鄰站 ETA 推算，並非巴士 GPS」。任何 stale、scheduled、錯誤、資料不足或 75 秒後的畫面刷新都要立即移除圖標。

這不是車輛追蹤演算法，也不能保證上游與下游 ETA 屬同一輛車。後續若官方回應被核實提供可跨站對應的 vehicle／trip identifier，才可在獨立研究和 fixture 驗證後收窄配對規則；在此之前，上述保守顯示比製造多個「巴士位置」安全。[2]

## 5. 鬧鐘隔離與既有功能回歸規則

詳細頁必須把「讀取 ETA」和「根據 ETA 通知」嚴格分離。現有主板的 alarm path 是 `refresh()` → `scheduleAlarmFallbacks()`／`checkAlarms()` → `notifyArrival()`，並包含 local plan、timer、notification、audio、vibration 和卡片 visual alert。detail path 不得引用該鏈。選中站即使與卡片相同，也只顯示 ETA；詳細頁關閉後既有 25 秒主板輪詢照常運作。

需在程式碼加入一個容易 review 的不變條件註解：`loadRouteDetailEtas` 和任何 queue worker **只能**呼叫 `fetchETA`、snapshot helper 和 detail renderer。它們不可以讀／寫 `alarms`、`alarmPlans`、`alarmSessions`、`alarmSeen`、`alarmFallbackTimers`、`getoff`、`prefs.notificationsEnabled` 或 `items`。也不可要求 Notification permission、註冊／訊息 Service Worker 或讀取位置。這比靠 UI 沒有鈴鐺按鈕更可靠。[1] [2]

既有路線卡告警發生時，`notifyArrival()` 目前只尋找 board card 元素；詳情頁不可複用 `data-id`、`data-alarm-id` 或 `data-alarm-note`，避免其 DOM 被誤選中。若主板 alarm 在詳情開啟時響起，允許原卡背景 flash／系統通知，但詳細頁最多顯示非互動的「主畫面有到站提醒」提示，且不新增第二次提示。

## 6. 自動化與實機瀏覽器測試方案

### 6.1 新增測試資產與 CI

| 檔案 | 用途 | 核心內容 |
| --- | --- | --- |
| `package.json`／lockfile | 鎖定 `@playwright/test`、`test`、`test:ui`、`test:syntax` scripts。 | 使用 `npm ci`，不使用浮動的全域 browser tooling。 |
| `playwright.config.mjs` | Chromium project、localhost baseURL、trace／screenshot on failure、single worker 以減少 localStorage／SW 互相污染。 | 每個 test 以獨立 browser context；可設定 `serviceWorkers:'block'` 測 API mock，另有一項允許 SW 的 smoke。 |
| `tests/fixtures/` | KMB、CTB、GMB 成功／無班次／error 資料、含 scheduled 和 timestamp 的固定回應。 | fixture 不能含真實用戶 localStorage 或不穩定實時數據。 |
| `tests/route-detail-ui.spec.mjs` | 點入、timeline、主題、鍵盤與 history。 | `page.route()` 攔截官方 API，避免測試依賴實時網絡。 |
| `tests/route-detail-eta.spec.mjs` | parser reuse 的可觀察輸出、優先 selected station、per-stop fallback、abort／generation 與推算門檻。 | 對 fetch call count 斷言 KMB detail sweep 只取 route ETA 一次。 |
| `tests/alarm-isolation.spec.mjs` | 詳情頁零鬧鐘副作用。 | Stub `Notification.requestPermission`、`navigator.geolocation`、SW `postMessage`、audio／vibrate；開詳情、選站、重試後均斷言計數為零，並比對所有 alarm localStorage values 未改。 |

### 6.2 必跑自動案例

1. 以 `addInitScript` 注入一條 KMB 儲存路線和 dark preference，首頁完全載入後，按「查看全線」進入詳情；標題、路線方向、站數和完整 station buttons 均出現，預設選中站等於 card 的儲存站。
2. 對 KMB fixture，驗證 selected station 的 ETA 三格為排序後前三筆，`rmk`／scheduled 視覺正確，並驗證同一路線的全線 sweep 只發出一次 KMB route ETA request。CTB 與 GMB 各至少一例，確認 immutable stop request 帶正確 `stopId`／`seq`／方向。
3. 點另一個站後，top summary 立即轉為 loading，完成後只顯示該站 ETA；card 的 `items`、儲存 `busboard.items.v1` 和已選 card station 不變。
4. 模擬 timeout／500 並預置仍在 20 分鐘內的本站 `busboard.eta-snapshot.v1`，驗證 stale label、由 ISO 重新計算分鐘和 cached 時間。把 `savedAt` 設為 20 分鐘以上，驗證只顯錯誤而沒有 ETA。
5. 模擬慢的路線 A 請求，立刻關閉並開路線 B；待 A 回應後，頁面仍只含 B 的資料。刪除開啟中的路線亦不能報 uncaught error。
6. 以 `body.light` 與 `font-large` preference 重跑 UI，檢查 text/background 使用 token 的 computed contrast、timeline selected state 可辨識，並以 mobile viewport（例如 390×844）截圖。另測 `Escape`、返回鈕與 browser Back，焦點回到原 detail button。
7. 兩相鄰站的 fresh non-scheduled ETA 僅在 30 秒至 20 分鐘的正向差值出現一個「推算」 marker；任何 stale、scheduled、倒置、過期或單站 fixture 均沒有 marker，並驗證文案含「非 GPS」。
8. 以 armed alarm fixtures 進入、換站、全線重試，確認無 notification permission、sound、vibration、GPS、SW message，且 `alarms`、`alarmPlans`、`alarmSessions` 和 `alarmSeen` 不改；再讓主板既有 refresh 回歸測試確認 armed card 原本行為仍有效。

### 6.3 發佈前人工瀏覽器驗收

自動 mock 不可取代真實 PWA 驗收。以 Chrome Android／Android 已安裝 PWA、Safari iOS 已加入主畫面，以及 desktop Chrome 各做一次：首次和舊 cache 更新、深／淺色、字型放大、慢速網絡、offline、從詳情返回、card map、GPS get-off、開／關鈴鐺、通知 permission、屏幕保護和 refresh。特別檢查詳情頁在手機安全區沒有被 top header 遮住，timeline 可流暢捲動，且所有推算 marker 永遠有非 GPS 標示。現有 README 已明示 mobile background execution／notification 並非保證，驗收記錄不可改稱鎖屏必達。[3]

靜態檢查最少包括：

```bash
# 從 repo root 執行；先以暫存檔抽出 inline script，再讓 Node 解析。
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

## 7. PWA 快取、部署與回滾

### 7.1 `sw.js` 的發佈要求

當 `index.html` 或新增 shared detail static file 進入發佈切片時，將 `SHELL` 由目前的 `buspulse-hk-shell-v30-redesigned-app-icon` 遞增成單調的新名稱，例如 `buspulse-hk-shell-v31-route-detail`。如新增 `route-detail-core.js`，必須列入 `FILES` 預快取；若 detail logic 留在 `index.html`，`FILES` 本身不用加檔，但 cache 名稱仍要升級。保留 `skipWaiting()`、`clients.claim()` 和 activate 時刪除非當前 shell 的行為，並保留 `url.hostname.endsWith('gov.hk') return`：ETA 不能被 SW cache 成舊結果。[4]

測試應檢查新版 SW 安裝後 app shell 包含 `index.html`、manifest、icons 及任何新增 static JS；離線時仍可 fallback 首頁；而 `gov.hk` mock request 不進 `caches`。service worker lifecycle 的更新不是 ETA 資料回退機制，故不應以它代替現有 20 分鐘 snapshot。[4]

### 7.2 GitHub Actions Pages gate

目前 workflow 只在 `main` push 或 manual dispatch 部署。[5] 將它拆成 `test` 和 `deploy` jobs：

1. `test` checkout、setup Node LTS、`npm ci`、安裝 Chromium、起 static server、執行 syntax、Playwright 及 `git diff --check`；上傳 Playwright report 作失敗 artifact。
2. `deploy` 設定 `needs: test`，只在 test 成功後執行現有 Pages configure、upload、deploy。
3. 為免 `path: .` 把 `node_modules`、`tests`、report、`.git` 或 workflow 配置送進 Pages，建立 `_site/` staging directory。可用 `rsync -a --delete` 並排除 `.git`、`.github`、`node_modules`、`tests`、`playwright-report`、`test-results`、`package*.json` 和研究文件；upload path 改成 `_site/`。必須有 workflow test 斷言 `_site/index.html`、`_site/sw.js`、`_site/manifest.json`、icons、`fare-index.json`、`place-index.json` 存在。
4. 把部署成功得到的 Git SHA、Pages URL、SW shell version 和三平台人工驗收結果寫到 `CHANGELOG.md`。不要以 cache 清除或 browser developer tools 作唯一驗收。

正式發布順序是：在 feature branch 跑全套 test → PR／review `git diff`（尤其 `sw.js`、alarm 區、localStorage key）→ merge 至 `main` → 觀察 `Deploy 港巴即時 to GitHub Pages` 的 test 和 deploy jobs → 在公開 Pages 以無痕頁驗證版本、更新一次、回到首頁、offline fallback 和 API failure UI → 再做已安裝 PWA 更新驗證。現有公開 repo／Pages URL 記於交接文件。[2]

### 7.3 可回滾的提交切片

建議不要 squash 到一個難以診斷的大提交。每次合併前為目前 `main` 建立保護 tag，例如 `pre-route-detail-2026-09-15`，並以以下順序提交；每個 hash 都記錄在 release note。

| 次序 | 建議提交訊息 | 可回滾範圍 |
| --- | --- | --- |
| 1 | `test: add static Playwright smoke harness` | 只移除 test tooling；產品行為不變。 |
| 2 | `feat(route-detail): add variant stop cache and detail data state` | 移除 core cache／state，保留原 map、GPS 和主板。 |
| 3 | `feat(route-detail): add accessible full-screen route timeline` | 移除 entry／overlay；主板卡片回原狀。 |
| 4 | `feat(route-detail): load per-stop ETA with safe fallback` | 移除 queue／snapshot presentation／推算 marker；不可混入 alarm 修改。 |
| 5 | `chore(pwa): gate Pages deployment and version detail shell` | 獨立處理 SW／CI／文件，方便在功能正常但 deployment 出錯時修復。 |

每個提交後至少跑前一節列出的 syntax、相關 Playwright specs 和 `git diff --check`；提交 2 至 4 再跑 `tests/alarm-isolation.spec.mjs`。commit 5 前確認 `_site` 不含 test dependency。切片的核心目的，是讓 emergency revert 不會把已驗證的 alarm／PWA 改動連同詳情頁一起錯誤回退。

### 7.4 回滾 runbook

**一般功能回滾：** 停止把後續功能 merge 到 `main`，記錄最後正常 SHA 和失敗症狀。以新 branch 建立 revert，而不是 force-push 或重寫公開 `main`：

```bash
git fetch origin
git switch -c rollback/route-detail origin/main
# 以實際提交 hash 由新至舊 revert；若要整組撤回，可先 --no-commit 後統一測試。
git revert --no-commit <commit-5> <commit-4> <commit-3> <commit-2>
npm test
git diff --check
git commit -m "revert: remove route detail release"
git push origin HEAD:main
```

推送會觸發現有 Pages workflow；確認 Pages deployment 使用 revert SHA，然後在無痕瀏覽器及已安裝 PWA 驗證主板、鬧鐘和離線首頁。若只發現 ETA sweep 問題，先只 revert 提交 4；若只 CI／artifact staging 失敗，修正或 revert 提交 5，避免不必要地撤掉穩定 UI。

**快取／PWA 緊急回滾：** 若恢復的 `index.html` 已正確但已安裝 app 仍取得壞 shell，不要僅重新跑舊 deployment。建立一個新的 rollback commit，保留恢復後的檔案並把 `SHELL` 再遞增至唯一名稱，例如 `v32-rollback-route-detail`；這能令新 service worker 安裝新版的「舊功能」shell，再由 activate 清除舊 cache。發布後至少以一個曾使用壞版的裝置驗證更新、關閉再開啟和 offline fallback。所有 revert／hotfix 都必須寫入 `CHANGELOG.md`，包括 source SHA、rollback shell name、部署 run URL、驗證裝置和遺留問題。[4] [5]

## 8. 合併前不可妥協的驗收清單

| 類別 | 必須成立 |
| --- | --- |
| 資料正確性 | 每個公司／方向／特別班次有正確 variant key；detail ETA 由既有 normalizer 產生；無站點之間 ETA 借用。 |
| 快取與失敗 | route stop 只成功 cache；detail request 可取消；snapshot 只對同一站且 20 分鐘內有效；stale／error／empty 可區分。 |
| 隔離 | 詳情操作零通知、零聲音、零震動、零 GPS、零 alarm plan／timer／localStorage alarm mutation。 |
| UI／可及性 | 三格 ETA、選中 station、deep/light/large font、鍵盤 focus、Escape／Back、mobile safe area、非 GPS label 全部通過。 |
| 推算誠信 | 只在相鄰、新鮮、非 scheduled、一致的資料中顯示至多一個 marker；任何不確定均不畫。 |
| PWA／部署 | 新 shell version、offline shell、`gov.hk` 不 cache、CI tests 先於 deploy、artifact 沒有 test dependencies。 |
| 回滾 | 已記錄 pre-release tag 和每個切片 hash；revert 於 branch 完成 test；cache emergency path 已在 staging／實機演練一次。 |

## References

[1]: https://github.com/cw91020251212/gang-baa-im-si-buspulse-hk/blob/main/index.html "BusPulse HK main application, adapters, storage, cache, alarms and refresh loop"

[2]: https://github.com/cw91020251212/gang-baa-im-si-buspulse-hk/blob/main/AI_HANDOFF.md "BusPulse HK engineering handoff and official-data limitations"

[3]: https://github.com/cw91020251212/gang-baa-im-si-buspulse-hk/blob/main/README.md "BusPulse HK README: local alarm model, PWA and privacy"

[4]: https://github.com/cw91020251212/gang-baa-im-si-buspulse-hk/blob/main/sw.js "BusPulse HK service worker app-shell cache and local notifications"

[5]: https://github.com/cw91020251212/gang-baa-im-si-buspulse-hk/blob/main/.github/workflows/pages.yml "GitHub Pages deployment workflow"
