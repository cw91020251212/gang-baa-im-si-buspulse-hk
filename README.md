# 港巴即時｜BusPulse HK

A lightweight Progressive Web App for checking real-time Hong Kong bus arrival information.

## Features

- Real-time ETA from KMB, Citybus and Green Minibus APIs provided by data.gov.hk.
- Save multiple routes and stops locally in the browser.
- Open an on-demand map on each route card to see the selected stop, all stops in route order, and a schematic connection line.
- Route lines are matched to the road network through OSRM where available, rather than drawing a straight line between stops.
- Preview the complete route map before selecting a stop, use browser GPS to zoom to the user's location, and choose a nearby stop directly from the map.
- Search route numbers by prefix, so entering `74` can return routes such as `74K` and `74X` where available.
- Show the official route full fare beside the selected stop.
- Enable a per-route arrival/alighting alarm with a configurable 1–5 minute lead time. The selected stop on a route card is the alert target; the card flashes, a short bell plays, and vibration/system notifications are used when the browser allows them.
- Provide display preferences for font size, 12/24-hour time, and dark/light mode.
- Offer a `▣ 開啟最上層小窗` action using the browser Document Picture-in-Picture API where supported; the small window shows simplified live ETA cards. Android devices without this API can use system split-screen mode instead.
- Installable as a PWA on supported mobile browsers.
- Optional true background push on Android: the browser subscribes to Web Push and the included Cloudflare Worker checks the official ETA APIs every minute, so notifications can appear above WhatsApp or other apps.
- A Cantonese step-by-step deployment guide is available in [CLOUDFLARE-BACKGROUND-PUSH-GUIDE.md](CLOUDFLARE-BACKGROUND-PUSH-GUIDE.md), including an architecture diagram, Cloudflare KV setup, VAPID secrets, Cron Trigger checks, and Android testing.
- Mobile-first interface with a compact, colourful arrival board.

## Map notes

The map uses Leaflet with OpenStreetMap tiles. Stop coordinates come from the public transport APIs where available. The blue line follows a road-network driving route between official stops where routing is available; it is a visual approximation, not the operator's exact bus-only geometry or a live bus GPS trace. Location access is requested only when the user taps the location button and is handled by the browser.

Fare labels use the Transport Department's biweekly public route-and-fare GeoJSON. A compact `fare-index.json` is committed for reliable browser loading because the original public file is large and does not provide browser CORS headers. The public dataset provides the route's `fullFare` value; it does not expose a complete stop-by-stop sectional fare table, so the label is the official full-route fare rather than an inferred segment fare.

Alerts have two layers. The static GitHub Pages app uses self-correcting refresh scheduling, persisted ETA-based fallback alarm plans, and a Service Worker notification path while the page is open or backgrounded. The included `worker/` directory adds the true background layer: after it is deployed with Cloudflare Worker + KV + VAPID secrets, the app can subscribe the Android browser and sync only routes with an enabled alarm. The Worker checks the official ETA APIs every minute, de-duplicates each bus trip, and sends Web Push directly to the Android system notification tray even when the page is suspended.

On Android, open the site in Chrome, allow notifications, use **「加入主畫面」**, open the installed app once, add a route, enable its bell, then open settings and enter the deployed Worker URL under **真正背景推送**. Android system notification permission and battery optimisation settings still control delivery. GitHub Pages alone cannot run a server-side poller, and this repository intentionally does not contain VAPID private keys.

The mini-window is a best-effort browser feature. `documentPictureInPicture` support varies by browser and platform; the UI reports when it is unavailable and does not break the normal page. The mini-window is refreshed whenever the main page receives fresh ETA data.

## Run locally

Because the app uses a service worker, serve the folder over HTTP instead of opening `index.html` directly:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Data and privacy

The app calls the official public APIs directly from the browser. Saved routes stay in the browser's local storage; there is no application server or account system.

## Suggested repository name

`gang-baa-im-si-buspulse-hk`

## License

Add the license that matches your intended use before publishing.

> Arrival times are for reference only. Actual service may change.

## Credits

Data source: [data.gov.hk](https://data.gov.hk/); map tiles © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
