# BusPulse HK background Web Push

這個 Worker 只使用標準 Web Push/VAPID，不使用 Android FCM、Firebase service account 或 APK。D1 保存 endpoint、p256dh、auth 和逐條路線 watch；每分鐘 Cron 分別以公司、路線、方向、站序／站點及服務類別查 ETA。

## Secrets（只可用 `wrangler secret put`）

- `VAPID_SUBJECT`：例如 `mailto:你的電郵`
- `VAPID_PUBLIC_KEY`：只可回傳給前端
- `VAPID_PRIVATE_KEY`：只放 Worker secret，不能提交 Git、不能放網頁

## 部署順序

1. 建立 D1，套用 `migrations/0001_init.sql`。
2. 填好 `wrangler.toml` 的 database id。
3. `npm ci`、`npm test`、`npx wrangler deploy --dry-run`。
4. 部署後先測 `/health`、`/vapid-public-key`、訂閱 POST/DELETE。
5. 只在真機測試訂閱已寫入 D1 後保留一個 Cron。

`/health` 只代表 Worker 可回應；Push Service 接受亦不代表手機已顯示通知，手機驗收必須另行記錄。
