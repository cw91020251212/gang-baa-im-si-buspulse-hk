# 官方／參考時間表資料研究

日期：2026-09-15

## Moovey reference

URL: https://moovey.net/route/KMB-74X-I-1.html

For KMB 74X outbound it displays:

- 首班車 05:30
- 尾班車 24:20
- 全程車資 $11.5
- 營運時間表按 weekday / Saturday / Sunday & public holiday
- 以時間段顯示班距，例如 09:08-17:00，6-8 分鐘／班
- 目前時段會標記為「當前時段」
- PDF timetable link: https://cdneshop.teamotto.me/bus/pdf/KMB-74X-I-1.pdf?v=0902

## Official KMB page

URL: https://search.kmb.hk/KMBWebSite/?action=routesearch&route=74X

Public route page has a route timetable tab. Its public script is:

https://search.kmb.hk/KMBWebSite/MapFunction.js?20250611114452

Relevant function `getSchedule(routeNo, bound)` calls:

`Function/FunctionRequest.ashx?action=getschedule&route=<route>&bound=<bound>`

The response is grouped by service type and includes fields used by the official page:

- `Route`
- `Bound`
- `Origin_Chi`, `Origin_Eng`
- `Destination_Chi`, `Destination_Eng`
- `ServiceType`, `ServiceType_Chi`, `ServiceType_Eng`
- `DayType` values such as `W`, `S`, `H`, `D`
- `BoundText1` / `BoundText2` containing departure-time strings
- `BoundTime1` / `BoundTime2`
- frequency table fields consumed by `addTimeFreqTableRow`

The official script maps day types to weekday, Saturday, holiday and everyday labels, and renders both departure times and frequency-minute tables.

## Implementation implication

The current BusPulse summary's hardcoded `首班：官方未提供` and `尾班：官方未提供` should be replaced by a direction-aware official KMB schedule request. The summary can show first departure, last departure and current-day frequency block; the details accordion can expose the full day-type schedule and official source link. The request must be generation/abort guarded and cached by route + bound, like route stops and ETA data.
