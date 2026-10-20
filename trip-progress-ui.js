/* On-device position marker for the existing route timeline. Never persisted or uploaded. */
let tripProgressSession = null;
const tripProgressJourneys = new Map();
const tripProgressRoadContexts = new Map();
function prepareTripProgressRoad(it, stops) {
  const key = routeVariantKey(it);
  if (tripProgressRoadContexts.has(key)) return tripProgressRoadContexts.get(key);
  const context = {lines:null};
  tripProgressRoadContexts.set(key, context);
  // Public route geometry only; no device coordinates in the request.
  officialRoutePath(it, stops).then(lines => { context.lines = lines; }).catch(() => {});
  return context;
}
function resetTripProgress() { tripProgressSession = null; scheduleBusSaver(); }
function selectTripProgress(it) {
  tripProgressSession = tripProgressJourneys.get(uid(it)) || null;
  scheduleBusSaver();
}
function ensureTripProgress(it) {
  const id = uid(it);
  let session = tripProgressJourneys.get(id);
  if (session) return session;
  const stops = routeStopsCache.get(routeVariantKey(it)) || (routeDetailState.item && uid(routeDetailState.item) === id ? routeDetailState.stops : []);
  if (stops.length < 2) return null;
  const road = prepareTripProgressRoad(it, stops);
  try {
    session = {routeId:id, lastFixAccepted:false, model:BusTripProgress.create({stops, boardingSeq:Number(stops[0].seq), targetSeq:Number(stops.at(-1).seq), startAnywhere:true, roadLines:road.lines})};
  } catch { return null; }
  tripProgressJourneys.set(id, session);
  if (routeDetailState.open && routeDetailState.item && uid(routeDetailState.item) === id) tripProgressSession = session;
  scheduleBusSaver();
  return session;
}
function acceptTripProgress(it, position) {
  const session = ensureTripProgress(it);
  if (!session) return;
  const c = position.coords;
  session.lastFixAccepted = BusTripProgress.ingest(session.model, {
    latitude:c.latitude, longitude:c.longitude, accuracy:c.accuracy,
    speed:c.speed, timestamp:position.timestamp ?? Date.now()
  }).accepted;
}
function tripProgressSnapshot(session = tripProgressSession) {
  return session ? BusTripProgress.snapshot(session.model) : null;
}
function tripProgressTimeline(it) {
  if (routeDetailState.gpsStatus !== 'watching' && !getoff[uid(it)]?.active) return '';
  const session = tripProgressJourneys.get(uid(it));
  const s = session && tripProgressSnapshot(session);
  if (!s || s.status === 'waiting') return '';
  const name = seq => routeDetailState.stops.find(st => Number(st.seq) === Number(seq))?.name || '';
  const where = s.nextSeq == null ? name(s.seq) : name(s.seq) + '與' + name(s.nextSeq) + '之間';
  const weak = s.status !== 'gps';
  const label = '你的位置：' + where + (weak ? '，訊號暫弱，位置為估算' : '');
  return '<div class="trip-user-position' + (weak ? ' is-estimated' : '') + '" data-trip-marker role="status" aria-label="' + esc(label) + '" title="' + esc(label) + '"><span class="trip-user-dot" aria-hidden="true">你</span>' + (weak ? '<small aria-hidden="true">訊號弱</small>' : '') + '</div>';
}
function updateTripProgressMarker(it = routeDetailState.item) {
  if (!it) return;
  const marker = routeDetailBody.querySelector('[data-trip-marker]');
  const timeline = routeDetailBody.querySelector('.stop-timeline');
  const session = tripProgressJourneys.get(uid(it));
  if (!marker || !timeline || !session) return;
  const s = tripProgressSnapshot(session);
  const dot = seq => timeline.querySelector('[data-detail-stop="' + cssEscape(String(seq)) + '"] .stop-dot');
  const from = dot(s.seq), to = s.nextSeq == null ? null : dot(s.nextSeq);
  if (!from) { marker.hidden = true; return; }
  const base = timeline.getBoundingClientRect();
  const a = from.getBoundingClientRect(), b = to?.getBoundingClientRect();
  const index = session.model.tripStops.findIndex(st => Number(st.seq) === Number(s.seq));
  const lo = session.model.cumulative[index], hi = session.model.cumulative[index + 1];
  const fraction = b && hi > lo ? Math.max(0, Math.min(.97, (s.progress * session.model.totalMeters - lo) / (hi - lo))) : 0;
  const y = a.top + a.height / 2 + (b ? (b.top + b.height / 2 - a.top - a.height / 2) * fraction : 0);
  marker.style.top = (y - base.top) + 'px';
  marker.style.left = (a.left + a.width / 2 - base.left) + 'px';
}
window.addEventListener('resize', () => updateTripProgressMarker());
window.addEventListener('DOMContentLoaded', () => {
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => updateTripProgressMarker()).observe(routeDetailBody);
}, {once:true});
