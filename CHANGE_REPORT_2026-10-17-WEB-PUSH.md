

## 2026-10-19 最后安全修正

移除了之前加入的宽松 Web Push payload 分支。该分支会在没有验证本机提醒开关、路线 ID 和 session 的情况下显示通知，因此不应保留在正式版本。现在 Service Worker 只接受 `data.kind === 'bus_arrival'`，并继续验证本机保存的路线及有效 session 后才显示系统通知。

本次已通过 `node --check sw.js` 及 `git diff --check`。Worker 本身没有修改；当前发布副本未带 Worker 测试目录，因此没有在此副本重复运行 Worker 单元测试。
