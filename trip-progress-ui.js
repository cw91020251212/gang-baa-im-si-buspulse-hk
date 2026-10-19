/* Local prototype only. No fetch, telemetry or persistence of location. */
let tripProgressSession = null;
let tripProgressBoardingSeq = null;
const tripProgressRoadContexts = new Map();
function prepareTripProgressRoad(it, stops) {
  const key = routeVariantKey(it);
  if (tripProgressRoadContexts.has(key)) return tripProgressRoadContexts.get(key);
  const context = {lines:null, pending:true};
  tripProgressRoadContexts.set(key, context);
  // Fetch by public route ID only, never by the user's current coordinates.
  officialRoutePath(it, stops).then(lines => { context.lines = lines; }).catch(() => {}).finally(() => {
    context.pending = false;
    if (routeDetailState.open && routeDetailState.item && routeVariantKey(routeDetailState.item) === key && !tripProgressSession) renderRouteDetail();
  });
  return context;
}
function resetTripProgress() { tripProgressSession = null; tripProgressBoardingSeq = null; scheduleBusSaver(); }
function acceptTripProgress(it, position) {
  if (!tripProgressSession || tripProgressSession.routeId !== uid(it) || !routeDetailState.open) return;
  const c = position.coords;
  BusTripProgress.ingest(tripProgressSession.model, {
    latitude:c.latitude, longitude:c.longitude, accuracy:c.accuracy,
    speed:c.speed, timestamp:position.timestamp || Date.now()
  });
}
function tripProgressSnapshot() {
  return tripProgressSession ? BusTripProgress.snapshot(tripProgressSession.model) : null;
}
function tripProgressPanel(it) {
  const stops = routeDetailState.stops, target = getoff[uid(it)];
  if (!stops.length) return '';
  const roadContext = prepareTripProgressRoad(it, stops);
  const boarding = Number(tripProgressBoardingSeq ?? it.seq ?? stops[0].seq);
  const snapshot = tripProgressSession?.routeId === uid(it) ? tripProgressSnapshot() : null;
  const intro = '<strong>我的行程 · 本地测试版</strong><small>只在本装置处理位置；不是官方巴士实时位置。ETA 候选位置不代表你乘坐的巴士。</small>';
  if (!snapshot) {
    const available = stops.filter(s => !target?.active || Number(s.seq) < Number(target.targetSeq));
    const options = available.map(s => '<option value="' + esc(s.seq) + '"' + (Number(s.seq) === boarding ? ' selected' : '') + '>第 ' + esc(s.seq) + ' 站 · ' + esc(s.name) + '</option>').join('');
    const ready = target?.active && available.some(s => Number(s.seq) === boarding);
    return '<section class="trip-progress" aria-label="我的行程">' + intro + '<label>实际上车站<select data-trip-boarding aria-label="实际上车站">' + options + '</select></label><small>请先设下车站，再在上车时开始；浏览其他站不会改变上车站。</small><button type="button" data-trip-start' + (!ready ? ' disabled' : '') + '>我已上车，开始行程</button></section>';
  }
  const name = seq => stops.find(s => Number(s.seq) === Number(seq))?.name || '—';
  const uncertain = snapshot.status === 'estimated' || snapshot.status === 'paused';
  const title = {waiting:'等待上车位置的可信 GPS',gps:'GPS 已确认 · 我的行程',estimated:'估算中 · 低信心',paused:'估算已暂停 · 等待 GPS'}[snapshot.status] || '等待 GPS';
  const percent = Math.min(uncertain || snapshot.nextSeq != null ? 99 : 100, Math.round(snapshot.progress * 100));
  const route = '上车：' + name(snapshot.boardingSeq) + ' → 下车：' + name(snapshot.targetSeq);
  const where = snapshot.status === 'waiting' ? '请保持页面开启，等待靠近所选上车站的准确位置。' : snapshot.nextSeq != null ? '第 ' + snapshot.seq + ' 站「' + name(snapshot.seq) + '」至第 ' + snapshot.nextSeq + ' 站「' + name(snapshot.nextSeq) + '」之间；余下约 ' + snapshot.remainingStops + ' 站' : 'GPS 显示已接近所选下车站，请留意实际站名。';
  const speed = Number(snapshot.speedMps) || 0;
  const segment = Number(snapshot.segmentMeters) || 0;
  const distanceBasis = snapshot.geometrySource === 'road' ? '沿已匹配的公开路线道路资料估算；不代表实际隧道长度' : '按站点连线 × 1.25 粗估，不是实测道路或隧道长度';
  const preflight = segment > 2000 ? '前方为长站距／可能无 GPS 路段（约 ' + (segment / 1000).toFixed(1) + ' 公里，' + distanceBasis + '）。' : distanceBasis + '。';
  const plan = speed > 0 ? '已参考近期移动，保守估速约 ' + Math.round(speed * 3.6) + ' km/h；失联推算上限约 ' + Math.ceil((snapshot.estimatedWindowSeconds || 0) / 60) + ' 分钟。' : '近期移动不足或车辆停定：失联后不会假设继续前进。';
  const caveat = uncertain ? '无 GPS 已约 ' + Math.floor((snapshot.elapsedSinceFix || 0) / 60) + ' 分钟。隧道塞车、停车及弯路可能令估算偏差；不会凭时间确认过站／到站。GPS 恢复后会校正，进度可能回退。' : '失去 GPS 20 秒后才低信心估算；到下一站前暂停，GPS 恢复后校正。';
  return '<section class="trip-progress' + (uncertain ? ' is-estimated' : '') + '" aria-label="我的行程">' + intro + '<p class="trip-route">' + esc(route) + '</p><div role="status" aria-live="polite"><b data-trip-status>' + esc(title) + '</b><p data-trip-position>' + esc(where) + '</p></div><progress max="100" value="' + percent + '" aria-label="我的行程进度"></progress><small>' + (uncertain ? '估算' : '') + '进度约 ' + percent + '%</small><small data-trip-plan>' + esc(preflight + ' ' + plan) + '</small><small>' + esc(caveat) + '</small><small>隧道内估算不触发落车通知；原有 GPS 落车提醒独立运行。此测试版须保持前台开启；行程中暂停自动屏保，关页后不会保留行程位置。</small><button type="button" data-trip-stop>结束此测试行程</button></section>';
}
function bindTripProgress(it) {
  routeDetailBody.querySelector('[data-trip-boarding]')?.addEventListener('change', e => { tripProgressBoardingSeq = Number(e.target.value); renderRouteDetail(); });
  routeDetailBody.querySelector('[data-trip-start]')?.addEventListener('click', () => {
    const target = getoff[uid(it)];
    const boardingSeq = Number(routeDetailBody.querySelector('[data-trip-boarding]')?.value);
    if (!target?.active || !Number.isFinite(boardingSeq) || boardingSeq >= Number(target.targetSeq)) return;
    tripProgressBoardingSeq = boardingSeq;
    try { tripProgressSession = { routeId:uid(it), model:BusTripProgress.create({stops:routeDetailState.stops, boardingSeq, targetSeq:Number(target.targetSeq), roadFactor:1.25, roadLines:tripProgressRoadContexts.get(routeVariantKey(it))?.lines}) }; } catch { alert('此路线有站点缺少可靠坐标，暂不能开始行程测试。'); return; }
    scheduleBusSaver();
    // Reuse the existing reminder watch; never feed estimated coordinates into it.
    renderRouteDetail();
  });
  routeDetailBody.querySelector('[data-trip-stop]')?.addEventListener('click', () => { resetTripProgress(); renderRouteDetail(); });
}
function tripProgressTimeline(it, seq) {
  if (!tripProgressSession || tripProgressSession.routeId !== uid(it)) return '';
  const s = tripProgressSnapshot();
  if (!s || s.status === 'waiting' || Number(s.seq) !== Number(seq)) return '';
  const estimated = s.status !== 'gps';
  const where = s.nextSeq == null ? 'GPS 已接近下车站' : '第 ' + s.seq + ' 至第 ' + s.nextSeq + ' 站之间';
  return '<div class="trip-timeline-marker' + (estimated ? ' is-estimated' : '') + '" data-trip-marker role="status"><b>我的行程 · ' + (estimated ? '估算／低信心' : 'GPS') + '</b><small>' + esc(where) + ' · 非官方巴士位置</small></div>';
}
