# BusPulse HK 鬧鐘手動重開修正報告

日期：2026-09-13

## 使用者要求

使用者表示想知道如何手動重新開啟巴士到站鬧鐘，並要求改好後留下一份報告，方便下一位助手繼續跟進。

## 原有情況

路線卡原本只顯示一個細小的鈴鐺圖示 `🔔`。程式實際上已有 `toggleAlarm()`，但介面沒有清楚顯示目前是開啟還是關閉。另一方面，背景 Worker 將每一次成功發送到站 Push 視為一次性行程；同一路線下一次要重新開始時，需要重新同步新的行程狀態。

## 今次修改

修改檔案：`index.html`

1. 關閉狀態的路線卡按鈕現在顯示 `🔕 開啟`。
2. 開啟狀態的路線卡按鈕現在顯示 `🔔 已開`。
3. 按鈕加入 `aria-pressed` 及更清楚的提示文字，方便 Android 螢幕閱讀器及使用者知道狀態。
4. 每次手動重新開啟鬧鐘時，清除該路線舊的本機 ETA reminder plan，避免沿用上一程已完成的計劃。
5. 關閉鬧鐘時仍會取消舊的本機提醒、清理頁面通知，並停止正在顯示的前端警報。
6. 路線設定頁新增操作說明：如果某次背景通知完成，想再等下一班車，先撳到 `🔕 開啟` 對應的關閉狀態，再撳一次重新開啟。
7. 保留遠端最新版本的 `alarmSessions` 及 `activeAlarmAlerts` 邏輯，避免覆蓋其他已完成的鬧鐘修正。

## Android 使用方法

1. 開啟 BusPulse HK 主畫面。
2. 在想提醒的路線卡右上角按 `🔕 開啟`。
3. 按鈕變成 `🔔 已開`，即代表本機到站鬧鐘已手動開啟。
4. 如果背景通知已經完成一次，而想再等下一班：再按一次 `🔔 已開` 使它關閉；再按一次變回 `🔔 已開`，即建立新的手動提醒 session。
5. 如果使用真正背景推送，重新開啟後等畫面顯示背景推送已同步，再切去其他 App 或鎖屏。

## 驗證結果

- 內嵌 JavaScript：`node --check` 通過。
- `git diff --check`：通過。
- 已保留遠端在本次修改前的最新提交 `95b3b37 Auto-complete one-time background alert routes`。
- 本次修改提交：`176ef9b Make alarm re-enable control clearer`。
- 已推送到 `origin/main`。
- GitHub Pages workflow 已啟動，run ID：`34755324208`；完成後要確認 conclusion 為 `success`。

## 下一步驗證

1. 等 GitHub Pages workflow `34755324208` 完成。
2. 開啟網址：<https://cw91020251212.github.io/gang-baa-im-si-buspulse-hk/>。
3. 強制重新整理，避免舊版 JavaScript cache：Android Chrome 可先關閉 App，再由主畫面圖示重新開啟；如仍然舊版，可清除該網站 cache，但先提醒使用者做資料備份。
4. 確認路線卡按鈕顯示 `🔕 開啟` 或 `🔔 已開`。
5. 手動按一次，確認文字及狀態改變；再按一次，確認恢復關閉。
6. 如果要測試真正背景通知，確認 Worker `/health` 仍回應 `{"ok":true,"cron":"every minute"}`，並確認 Android 通知及電池背景權限已允許。

## 重要安全及行為備註

- 不要在報告或聊天中重複 VAPID private key。
- Worker 的一次性背景推送完成，不會自動把前端畫面鬧鐘改成關閉；使用者需要按新的 `🔕 開啟`／`🔔 已開` 手動控制。
- 只可以在成功部署並重新載入最新 GitHub Pages 版本後，才向使用者說「已更新」。
