# Vehicle count / live bus data findings

Date: 2026-09-15

## Official KMB API

Source: https://data.etabus.gov.hk/v1/transport/kmb/route-eta/74X/1

A live response contains `co`, `route`, `dir`, `service_type`, `seq`, destination fields, `eta_seq`, `eta`, remarks, and `data_timestamp`. It does not contain vehicle ID, bus plate, latitude, longitude, speed, heading, or a route-level active-vehicle count.

Source/specification: https://data.etabus.gov.hk/datagovhk/kmb_eta_api_specification.pdf

The Route ETA specification describes ETA for all stops on a route and shows the same fields; it does not define a vehicle-count field. A route ETA row is a forecast for a stop, not a unique vehicle identity.

## Moovey reference implementation

Source: https://moovey.net/route/KMB-74X-I-1.html
SDK: https://moovey.net/web/js/busEta.js?v=1.0.12.20260904140348

Moovey's public SDK KMB branch calls `https://data.etabus.gov.hk/v1/transport/kmb/eta/{stop}/{route}/{service_type}` and returns the official ETA rows. Its `busInfo` / `busPlate` / speed / coordinate logic appears in other operator branches (for example Macau), not in the KMB branch. Therefore the screenshot's bus icon and "巴士接近中" presentation is an ETA interpretation, not a KMB vehicle count from the official public endpoint.

## Product decision

The app must not count ETA rows at different stops as unique buses because one bus can appear in ETA predictions for multiple upcoming stops. The route detail now shows `有即時預報：N 個站` and labels it as ETA coverage, not vehicle count. The selected-stop badge shows `巴士接近中` or `下一班巴士約 N 分鐘後` when the ETA supports it. It does not claim a number of vehicles without a unique vehicle field.
