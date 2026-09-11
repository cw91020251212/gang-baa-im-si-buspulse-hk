# BusPulse background push prototype

This directory implements the architecture used by the closest GitHub transit-alert example: a Cloudflare Worker polls the official ETA APIs on a Cron Trigger, stores Web Push subscriptions in KV, and sends a system notification when a trip enters the alert window. The GitHub Pages app remains the user interface.

## What is included

- `src/index.js`: Worker HTTP endpoints and one-minute `scheduled()` handler.
- `wrangler.toml`: Cron and KV binding configuration.
- `package.json`: Cloudflare-compatible Web Push implementation.
- `test/worker.test.js`: deterministic ETA-window tests.

## Required deployment setup

1. Create a Cloudflare Worker and a KV namespace.
2. Replace the KV IDs in `wrangler.toml`.
3. Generate VAPID keys with `npx web-push generate-vapid-keys` or another RFC 8292-compatible generator.
4. Set `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY` as Worker secrets.
5. Set `ALLOWED_ORIGIN` to the exact deployed site origin.
6. Deploy with Wrangler.
7. Connect the front end to `/vapid-public-key` and `/subscribe`; the request body must contain the browser PushSubscription and the saved route objects.

## Important status

This is an experiment scaffold, not a deployed notification service. It does not send anything until Cloudflare credentials, a KV namespace, VAPID secrets, and a front-end subscription flow are configured. Do not put VAPID private keys in GitHub or in the browser.

## Local test

```bash
npm install
npm test
```

The Worker polls once per minute. It de-duplicates each route/trip in KV and removes expired push subscriptions when the push service returns HTTP 404 or 410.
