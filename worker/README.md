# BusPulse background push

This directory contains the Cloudflare Worker for BusPulse HK background push notifications. The GitHub Pages app remains the user interface, while the Worker checks official ETA APIs and sends Web Push notifications.

## Safety design

The Worker no longer uses `KV.list()` in the minute-level path. It stores subscription keys in one `meta:active-subscriptions` index and reads that index with a normal KV `get()`. When the index is empty, the scheduled handler returns immediately. This avoids the previous design that consumed one KV list operation every minute even when nobody was subscribed.

Only one production Worker must have a Cron schedule at any time. The default `wrangler.toml` intentionally contains no Cron trigger. A Cron trigger must not be enabled until the new build has been deployed and verified; the second Worker must remain without a schedule.

The individual `/subscribe` DELETE endpoint removes only the requesting browser's subscription and its index entry. It does not stop the Worker, change the Cron schedule, delete the KV namespace, or affect other users.

## Files

- `src/index.js`: Worker HTTP endpoints, active subscription index, ETA checks, and Web Push handler.
- `wrangler.toml`: Worker name, KV binding, origin, and safe no-Cron default.
- `package.json`: Cloudflare-compatible Web Push dependency.
- `test/worker.test.js`: deterministic ETA-window tests.

## Required deployment setup

1. Use one production Worker name only.
2. Bind the existing KV namespace to `SUBSCRIPTIONS`.
3. Set `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY` as Worker secrets. Never commit private keys to GitHub or send them in chat.
4. Set `ALLOWED_ORIGIN` to the exact deployed site origin.
5. Deploy this build without a Cron trigger first.
6. Verify `/health` reports `kvStrategy: active-index-no-list`.
7. Verify POST and DELETE `/subscribe` update the index correctly.
8. Keep all other Worker schedules empty.
9. Only then enable one Cron trigger on one production Worker and monitor usage after the first reset.

## Local test

```bash
npm install
npm test
npx wrangler deploy --dry-run --outdir /tmp/buspulse-worker-dist
```

The Worker de-duplicates each route/trip in KV and removes expired Push subscriptions when the push service returns HTTP 404 or 410. It does not automatically enable another Cloudflare account, Worker, or Cron when a limit is reached.
