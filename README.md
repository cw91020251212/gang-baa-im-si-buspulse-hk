# 港巴即時｜BusPulse HK

A lightweight Progressive Web App for checking real-time Hong Kong bus arrival information.

## Features

- Real-time ETA from KMB, Citybus and Green Minibus APIs provided by data.gov.hk.
- Save multiple routes and stops locally in the browser.
- Open an on-demand map on each route card to see the selected stop, all stops in route order, and a schematic connection line.
- Route lines are matched to the road network through OSRM where available, rather than drawing a straight line between stops.
- Search route numbers by prefix, so entering `74` can return routes such as `74K` and `74X` where available.
- Show the official route full fare beside the selected stop.
- Tap **查看完整路線及沿途車站** on any saved route to open a full-screen, keyboard-accessible timeline. Each stop can be selected independently to view its own three-slot live ETA panel; the compact card, alarm, GPS and get-off reminder remain separate.
- Each ETA slot presents both the local expected arrival clock time and the remaining-minute countdown; scheduled services retain an explicit 「原定班次」 remark, while empty data remains a dash or explanatory text rather than a false zero.
- KMB and Citybus detail pages provide **↔ 對調方向**. Switching clears the old stop list and ETA state before loading the reverse variant, so station names and timings from the previous direction cannot appear under the new heading. GMB is not reversed by guessing because its API requires an explicit route variant.
- The detail summary shows the official full-route fare from the committed fare index. The current official route/ETA responses do not expose a reliable first-bus or last-bus field, so those two labels explicitly say 「官方未提供」 rather than displaying an inferred timetable.
- On long route timelines, the selected stop, its three ETA cards, and the freshness/error message stay in a sticky live dock while the stop list scrolls. The status region uses polite accessibility announcements so refreshes do not interrupt reading.
- The selected-stop status area also has **立即更新全部車站 ETA**. It performs one current route sweep, shows a busy label while running, and does not create a second request when pressed repeatedly during the same sweep.
- KMB route detail loads one route ETA response and groups it by stop. Citybus and Green Minibus detail requests use bounded concurrency. Recent per-stop ETA snapshots may be shown with an explicit stale-data warning when the live request fails.
- When a detail page opens, the station already selected on the compact route card is placed first in the ETA queue. A stale or failed station exposes a station-only **重新載入本站 ETA** action; it does not reload the main board or touch alarm/GPS state.
- A small **推算中** marker may appear between adjacent stops only when fresh, same-batch, non-scheduled ETAs satisfy conservative timing checks. It is an ETA-derived visualization, **not bus GPS or verified vehicle tracking**, and is hidden whenever the evidence is insufficient.
- Enable a per-route arrival/alighting alarm with a configurable 1–5 minute lead time. Arrival sound, vibration and notification are strictly opt-in: a route only alerts after its bell button has been turned on by the user. Routes displayed on the board but left unarmed never produce an arrival sound. After one arrival reminder, the alarm turns itself off; disabling the bell, deleting the route or clearing all alarms also cancels queued fallback and native reminders.
- Calculate the countdown locally from the latest ETA received by the browser.
- Store local alarm plans in the browser and use the Service Worker only for local notification display and app-shell caching.
- Provide display preferences for font size, 12/24-hour time, and dark/light mode.
- Provide a black screensaver for long-running bus monitoring, with a moving red side-view bus and adjustable automatic start time of 15 seconds, 30 seconds, 45 seconds, 1 minute, 2 minutes or 5 minutes; it can also be set to manual-only and is dismissed by tapping the screen.
- Offer a `▣ 開啟最上層小窗` action using the browser Document Picture-in-Picture API where supported. Android devices without this API can use system split-screen mode instead.
- Installable as a PWA on supported mobile browsers.
- Mobile-first interface with a compact, colourful arrival board.

## Alarm model and limitations

The alarm is a local, ETA-based reminder. The browser must first obtain an ETA from the official transport APIs; the countdown is not a source of independently verified bus location. Actual arrival time can change.

The route-detail timeline also does not provide vehicle coordinates. Its optional marker says **「按相鄰站 ETA 推算，並非巴士 GPS」** and is deliberately removed for stale, scheduled, failed or contradictory data.

The app does not use Web Push, a Cloudflare Worker, VAPID keys, server-side subscriptions or a background server poller. These components were removed because the local alarm already fulfils the current product requirement, while Web Push added registration, permission, subscription, server and maintenance complexity without an essential product benefit. The removal rationale and the implementation record are in [WEB_PUSH_POSTMORTEM.md](WEB_PUSH_POSTMORTEM.md).

Notification delivery remains subject to browser and operating-system permissions, background execution rules, battery optimisation and network availability. The interface must not promise guaranteed delivery after the browser or operating system has stopped the page.

The screensaver is a visual idle mode and does not stop ETA polling or local alarm logic while the page remains active. Mobile browsers may throttle or suspend background pages, so keeping the installed app visible and allowing the relevant battery and notification permissions remains important for long waits.

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

To run the regression suite locally:

```bash
npm ci
npx playwright install chromium
npm test
```

GitHub Pages is gated by the same test suite. The deployment job only runs after tests, inline JavaScript syntax, service-worker syntax and whitespace checks pass, and it uploads a clean `_site/` containing runtime files only.

## Route-detail handoff reports

The route-detail work was deliberately divided into independently reviewable stages. The [final engineering handoff](ROUTE_DETAIL_RESEARCH_FINAL.md) records the API contracts, data model, conservative ETA-inference rules, accessibility requirements, side-effect boundaries and rollback plan. The original [research brief](ROUTE_DETAIL_RESEARCH.md) records the problem definition and investigation scope; the supporting [API report](research-stage-1-api.md), [UX report](research-stage-2-ux.md) and [implementation plan](research-stage-3-implementation.md) can be assigned separately to another engineer.

## Data and privacy

The app calls the official public APIs directly from the browser. Saved routes and local alarm plans stay in the browser's local storage; there is no application server, account system or Push subscription database.

## Suggested repository name

`gang-baa-im-si-buspulse-hk`

## License

Add the license that matches your intended use before publishing.

> Arrival times are for reference only. Actual service may change.

## Credits

Data source: [data.gov.hk](https://data.gov.hk/); map tiles © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
