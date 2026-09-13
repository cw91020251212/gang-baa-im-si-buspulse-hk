# BusPulse HK 自製鬧鐘跟進修正

日期：2026-09-14

今次重新檢查 GitHub 最新 `main` 版本後，確認程式已經使用 Cloudflare Worker + Web Push + 本機 ETA fallback 三層提醒。Worker `/health` 及 `/vapid-public-key` 端點均正常回應，Worker 單元測試 5 項全部通過。

實際修正一個會令手機鬧鐘登記失敗的時序問題：使用者撳路線鈴鐺時，原本會同時申請通知權限及建立 Push subscription，但未等待權限完成；Android／Chrome 可能因此拒絕 Push 訂閱。現在會先完成通知權限，再同步背景鬧鐘，並等待同步結果。設定頁亦新增「重新同步背景鬧鐘」按鈕，方便權限曾經改動或 Worker 連線中斷後重新登記。

測試方式：開啟路線鈴鐺後，設定頁展開「背景推送」，按「重新同步背景鬧鐘」，確認狀態顯示「已開啟真正背景提醒；切去其他 App 都會收到通知」，再按 Home 或鎖屏測試。每條路線只提醒一程；到站通知完成後要重新撳鈴鐺等下一班。

已通過前端 inline JavaScript syntax check、`node --check sw.js`、Worker `npm test`（5/5）及 `git diff --check`。Service Worker cache 版本更新至 `v25`。
