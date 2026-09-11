# BusPulse HK 變更記錄：無鬧鐘時取消背景推送

日期：2026-09-12

## 問題

`syncPushSubscription()` 原本在啟用鬧鐘路線清單為空時直接返回，沒有通知 Worker 刪除訂閱。因此關閉最後一條鬧鐘後，手機可能仍留在 Worker KV 的背景查詢名單。

## 修正

修改 `index.html`：

- 加入 `deletePushSubscription(base, sub)` 共用刪除函式。
- 無任何啟用鬧鐘時，`syncPushSubscription()` 會呼叫 `DELETE /subscribe`。
- 仍有鬧鐘時，只 POST `items.filter(it => alarms[uid(it)])`，只同步啟用鬧鐘路線。
- 關閉單條鬧鐘、關閉全部鬧鐘、刪除路線後立即同步。
- 網站啟動時重新同步，清理舊版本遺留的無鬧鐘訂閱。
- `disableBackgroundPush()` 使用同一個刪除函式。

## 不變的設計

沒有改 ETA 查詢頻率、提醒窗口或通知去重邏輯。仍然是一部手機一個 Push 訂閱，訂閱內包含多條啟用路線；只有進入提醒窗口的班次才發通知。

沒有加入單一指定巴士追蹤或按 ETA 距離調整查詢頻率，因為一般路線會同時有多架巴士。

## 驗證

- 前端 JavaScript `node --check`：通過。
- `git diff --check`：通過。
- Worker 單元測試：3 項通過。
- 線上 Worker `/health`：正常，回應 `{"ok":true,"cron":"every minute"}`。
- 線上 `/vapid-public-key`：正常。

## Git

- `becffc6` — `Cancel background push when no alarms remain`
- `c615fe6` — `Resync background subscription on startup`

兩個提交已推送到 `main`。

## 後續 AI 交接重點

修改背景推送前，先閱讀本文件及 `index.html` 的 `pushRoutePayload`、`deletePushSubscription`、`syncPushSubscription`、`toggleAlarm`、`clearAllArrivalAlarms`。

必須保持不變式：

> 沒有啟用鬧鐘，就不應保留這部手機的 Worker 訂閱；有啟用鬧鐘時，Worker 只接收啟用路線。

早期 PDF 曾描述 Worker 為 prototype／未部署；本次已確認線上 Worker endpoint 正常。日後仍應以 `/health`、Worker 清單和實際 Cron 設定重新驗證。

## 安全及限制

本次沒有刪除 Cloudflare 資源、修改 secrets 或執行不可逆操作。文件不包含任何 private key、token 或登入資料。真實手機鎖屏端到端測試仍應獨立驗證。

## 相關檔案

- `index.html`
- `sw.js`
- `worker/src/index.js`
- `worker/test/worker.test.js`
- `worker/wrangler.toml`

---

文件版本：1.0；最後更新：2026-09-12

**核心結論：沒有啟用鬧鐘，就沒有必要保留背景推送訂閱。**

完

