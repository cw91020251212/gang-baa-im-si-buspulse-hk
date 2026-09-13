# BusPulse HK 變更記錄：一次性行程背景提醒

日期：2026-09-13

## 修改目的

背景 Push quota 有限；如果用家長期保留已完成的路線，Worker 會繼續每分鐘查 ETA。今次將背景訂閱內的每條路線視為一次性行程。

## 修改內容

`worker/src/index.js` 的 `checkSubscription()` 現在會：

1. 沒有進入提醒窗口的路線繼續保留；
2. 成功發出一次到站 Push 後，立即將該路線從這部手機的訂閱清單移除；
3. 如果所有路線都已完成，刪除這部手機的 Push subscription 及 active index entry；
4. 只刪除該部手機的訂閱，不會刪除共用 Worker、KV namespace、Cron 或其他用家的訂閱；
5. 如果 Push 服務回應 404/410，按原有邏輯清理失效裝置訂閱。

前端每條路線鬧鐘仍然由用家手動控制；開啟背景 Push 不會自動開啟鬧鐘。今次自動完成只針對 Worker 的背景查詢路線，避免誤改用家的本機鬧鐘選擇。

## 驗證重點

- Worker source syntax：需以 Node syntax check 驗證。
- Worker unit tests：需執行既有測試。
- Git diff check：需通過。
- 部署後應確認 `/health` 仍回應 `cron: every minute`。
- 真實手機測試：開啟兩條背景路線，等其中一條成功通知後，確認該條停止背景查詢，另一條仍然保留。

## 重要限制

「一次性行程」以 Worker 成功發出第一個符合提醒窗口的 Push 為完成，不會自動關閉前端畫面上的本機鬧鐘開關。用家日後若要再次提醒同一路線，需要手動重新同步／重新開啟該路線的背景鬧鐘。

## 追加：行程 session 防止完成後重新加入

前端每次手動開啟某條鬧鐘會建立新的 session；Worker 在成功發出該 session 的第一次到站通知後保存完成標記。日後頁面重新載入或同步時，已完成 session 不會重新加入背景訂閱；用家關閉再重新開啟鬧鐘時會產生新 session，才會重新開始一次行程。
