# BusPulse HK 自製鬧鐘跟進修正

日期：2026-09-14

今次重新檢查 GitHub 最新 `main` 版本後，確認程式已經使用 Cloudflare Worker + Web Push + 本機 ETA fallback 三層提醒。Worker `/health` 及 `/vapid-public-key` 端點均正常回應，Worker 單元測試 5 項全部通過。

實際修正一個會令手機鬧鐘登記失敗的時序問題：使用者撳路線鈴鐺時，原本會同時申請通知權限及建立 Push subscription，但未等待權限完成；Android／Chrome 可能因此拒絕 Push 訂閱。現在會先完成通知權限，再同步背景鬧鐘，並等待同步結果。設定頁亦新增「重新同步背景鬧鐘」按鈕，方便權限曾經改動或 Worker 連線中斷後重新登記。

測試方式：開啟路線鈴鐺後，設定頁展開「背景推送」，按「重新同步背景鬧鐘」，確認狀態顯示「已開啟真正背景提醒；切去其他 App 都會收到通知」，再按 Home 或鎖屏測試。每條路線只提醒一程；到站通知完成後要重新撳鈴鐺等下一班。

已通過前端 inline JavaScript syntax check、`node --check sw.js`、Worker `npm test`（5/5）及 `git diff --check`。Service Worker cache 版本更新至 `v25`。

## 2026-09-14 後續更正：背景推送預設長開

按使用者要求，設定頁不再提供「重新同步背景鬧鐘」作為日常操作。背景推送是本程式依賴的核心背景功能，預設保持開啟；新增路線、開關路線鈴鐺、重新開啟 App、恢復前景及修改 Worker URL 時，程式會自動同步目前開啟鬧鐘。設定頁只保留「真正關閉」作為手動停用入口；重新開啟後會由程式自動建立 Push 訂閱。

## 2026-09-14 徽章回歸修正

發現真正背景 Web Push 路徑只呼叫 `showNotification()`，沒有在 Service Worker 的 `push` event 呼叫 `setAppBadge()`；因此背景通知可能出現，但主畫面 App 數字 `1` 消失。現已補回 Service Worker 徽章設定，並令 Cloudflare Worker Push payload 明確帶 `badgeNumber: 1`。通知仍保持 `silent: false`、系統聲音及頂部通知。按通知後原有 `clearAppBadge()` 會清除數字。


## 2026-09-14 最終更正：Web Push 方案撤回

本報告前文關於「背景推送是本程式依賴的核心背景功能」及其相關修正，只記錄當時的錯誤工程方向，不能視為現行產品規格或可靠性證明。後續重新檢討後確認：本地 ETA 鬧鐘已能完成目前產品需求，Web Push 沒有不可替代的產品價值，反而增加訂閱、授權、VAPID、Worker、伺服器同步及維護成本。

因此，Web Push、Cloudflare Worker、Push 訂閱、背景推送設定、背景推送測試及相關介面已全部移除。現行架構只保留本地倒數、本地鬧鐘計時及本地通知顯示。完整失誤、未驗證承諾、時間損失及日後 AI 參考規則，見 [WEB_PUSH_POSTMORTEM.md](WEB_PUSH_POSTMORTEM.md)。
