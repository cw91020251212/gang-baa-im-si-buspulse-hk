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


## 2026-09-13 更正

使用者指出上一版不應更換鬧鐘外觀。因此已在提交 `16d8a80 Restore alarm icon and fix manual toggle` 還原原本單獨 `🔔` 圖示、原本的提示文字及原本設定頁文字，沒有保留 `🔕 開啟`／`🔔 已開` 新外觀。

今次實際功能修正只有兩項：

1. 移除鬧鐘正在顯示提示時的提前 return，令使用者仍可手動再按一次鬧鐘按鈕來切換開／關，而不會只停止提示卻看似沒有反應。
2. 恢復原本的 session、alarm plan 及背景同步流程；開啟鬧鐘會建立新的 session，關閉鬧鐘會清除本機提醒計劃。

驗證：JavaScript syntax check 通過、`git diff --check` 通過，已推送到 `origin/main`。下一步只需等待 GitHub Pages 部署後，用手機重新載入網站測試原本 `🔔` 按鈕。


## 2026-09-13 最終根因修復

使用者再次確認原本金色開啟／白色斜線關閉外觀本身冇問題，只係按鈕完全冇反應。檢查後發現：`toggleAlarm()` 會呼叫 `newAlarmSession()`、`saveAlarmSessions()` 及 `ensureAlarmSession()`，但當時 `index.html` 缺少這三個函式及 `alarmSessions` 初始化。按鈕 click handler 因此在狀態切換前拋出 `ReferenceError`，導致金色／白色狀態完全不變。

已在提交 `f964110 Fix alarm toggle session initialization` 補回：

- `loadAlarmSessions()`
- `alarmSessions` 初始化
- `saveAlarmSessions()`
- `newAlarmSession()`
- `ensureAlarmSession()`

今次沒有修改鈴鐺圖案、CSS、按鈕文字或原本開／關顯示。JavaScript syntax check 及 `git diff --check` 通過，已推送到 `origin/main`。


## 2026-09-13 一程一次自動關鐘

按使用者要求，鬧鐘現改為「一程一次」：前景頁面成功觸發到站提醒後，會立即把該路線的鬧鐘狀態改回關閉，保留原本金色／白色斜線顯示，並清理本機 session、fallback timer 及 reminder plan。要等下一班，只需再撳原本鈴鐺一次。

背景推送完成後，Worker 的 `/subscribe` 回應會帶回已完成路線；App 下一次恢復或同步時會根據這個回應把對應鬧鐘改回關閉。Worker 本身仍會在成功 Push 後移除已完成路線，沒有其他路線時刪除該裝置的 Push subscription，避免持續每分鐘查詢。


## 2026-09-13 第三者邏輯審查

審查發現一個實際邏輯缺口：前景頁面先響鐘並將路線關閉，但沒有即時把該路線從 Worker 的 Push subscription 移除；在極短時間內，Worker 仍可能對同一程發出背景 Push。現已在前景自動關鐘後立即重新同步，無啟用路線時會刪除手機 Push subscription。

另外，背景完成後的 `/subscribe` 回應現在會列出已完成路線；App 恢復或同步時會把相應鬧鐘切回原本的關閉外觀。設定頁及 README 亦已清楚寫明「每條路線只提醒一程，響完自動關閉；下一班要再撳原本鈴鐺」。原有鈴鐺外觀沒有改動。
