# 港巴即時｜BusPulse HK

A lightweight Progressive Web App for checking real-time Hong Kong bus arrival information.

## Features

- Real-time ETA from KMB, Citybus and Green Minibus APIs provided by data.gov.hk.
- Save multiple routes and stops locally in the browser.
- Open an on-demand map on each route card to see the selected stop, all stops in route order, and a schematic connection line.
- Route lines are matched to the road network through OSRM where available, rather than drawing a straight line between stops.
- Search route numbers by prefix, so entering `74` can return routes such as `74K` and `74X` where available.
- Show the official route full fare beside the selected stop.
- Enable a per-route arrival/alighting alarm with a configurable 1–5 minute lead time. The selected stop on a route card is the alert target; the card flashes, a short bell plays, and local system notifications are used when the browser allows them.
- Calculate the countdown locally from the latest ETA received by the browser.
- Store local alarm plans in the browser and use the Service Worker only for local notification display and app-shell caching.
- Provide display preferences for font size, 12/24-hour time, and dark/light mode.
- Offer a `▣ 開啟最上層小窗` action using the browser Document Picture-in-Picture API where supported. Android devices without this API can use system split-screen mode instead.
- Installable as a PWA on supported mobile browsers.
- Mobile-first interface with a compact, colourful arrival board.

## Alarm model and limitations

The alarm is a local, ETA-based reminder. The browser must first obtain an ETA from the official transport APIs; the countdown is not a source of independently verified bus location. Actual arrival time can change.

The app does not use Web Push, a Cloudflare Worker, VAPID keys, server-side subscriptions or a background server poller. These components were removed because the local alarm already fulfils the current product requirement, while Web Push added registration, permission, subscription, server and maintenance complexity without an essential product benefit. The removal rationale and the implementation record are in [WEB_PUSH_POSTMORTEM.md](WEB_PUSH_POSTMORTEM.md).

Notification delivery remains subject to browser and operating-system permissions, background execution rules, battery optimisation and network availability. The interface must not promise guaranteed delivery after the browser or operating system has stopped the page.

## Map notes

The map uses Leaflet with OpenStreetMap tiles. Stop coordinates come from the public transport APIs where available. The blue line follows a road-network driving route between official stops where routing is available; it is a visual approximation, not the operator's exact bus-only geometry or a live bus GPS trace. Location access is requested only when the user taps the location button and is handled by the browser.

Fare labels use the Transport Department's biweekly public route-and-fare GeoJSON. A compact `fare-index.json` is committed for reliable browser loading because the original public file is large and does not provide browser CORS headers. The public dataset provides the route's `fullFare` value; it does not expose a complete stop-by-stop sectional fare table, so the label is the official full-route fare rather than an inferred segment fare.

Each route alarm is intentionally **one trip only**. When the local arrival reminder is delivered, the route alarm returns to its original off state. To wait for another bus on the same route, press the original bell icon again.

The mini-window is a best-effort browser feature. `documentPictureInPicture` support varies by browser and platform; the UI reports when it is unavailable and does not break the normal page. The mini-window is refreshed whenever the main page receives fresh ETA data.

## Run locally

Because the app uses a service worker, serve the folder over HTTP instead of opening `index.html` directly:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Data and privacy

The app calls the official public APIs directly from the browser. Saved routes and local alarm plans stay in the browser's local storage; there is no application server, account system or Push subscription database.

## Suggested repository name

`gang-baa-im-si-buspulse-hk`

## License

Add the license that matches your intended use before publishing.

> Arrival times are for reference only. Actual service may change.

## Credits

Data source: [data.gov.hk](https://data.gov.hk/); map tiles © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
