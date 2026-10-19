/* BusTripProgress — in-memory ordered-route progress engine. */
(function (root) {
  'use strict';

  const EARTH = 6371000;
  const MAX_ACCURACY = 100;
  const MAX_DEVIATION = 300;
  const FIX_MAX_AGE = 120000;
  const FUTURE_TOLERANCE = 30000;
  const SAMPLE_WINDOW = 90000;
  const LOST_SIGNAL_MS = 20000;
  const MAX_ESTIMATE_MS = 20 * 60 * 1000;
  const MAX_SPEED = 45;
  const EPSILON = 0.5;

  function validNumber(n) { return typeof n === 'number' && Number.isFinite(n); }
  function haversine(a, b) {
    const rad = Math.PI / 180;
    const p1 = a.lat * rad, p2 = b.lat * rad;
    const dp = (b.lat - a.lat) * rad, dl = (b.lng - a.lng) * rad;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function project(point, a, b) {
    // Local equirectangular projection is suitably accurate for the short Hong Kong route segments.
    const lat0 = (a.lat + b.lat + point.lat) / 3 * Math.PI / 180;
    const scaleX = Math.cos(lat0) * Math.PI / 180 * EARTH;
    const scaleY = Math.PI / 180 * EARTH;
    const ax = a.lng * scaleX, ay = a.lat * scaleY;
    const bx = b.lng * scaleX, by = b.lat * scaleY;
    const px = point.lng * scaleX, py = point.lat * scaleY;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const x = ax + t * dx, y = ay + t * dy;
    return { t, distance: Math.hypot(px - x, py - y) };
  }
  function blank(model, now, reason, status = 'waiting') {
    return {
      status, confidence: status === 'gps' ? 'high' : 'low',
      seq: model.boardingSeq, nextSeq: model.boardingSeq, boardingSeq: model.boardingSeq,
      targetSeq: model.targetSeq, progress: 0, remainingStops: model.tripStops.length - 1,
      elapsedSinceFix: null, reason, speedMps: 0, estimatedWindowSeconds: 0, segmentMeters: null,
      geometrySource: model.geometrySource ?? 'stop-chord'
    };
  }
  function roadGeometry(stops, roadLines) {
    // Only one continuous line is accepted: multipart shapes are never stitched across gaps.
    if (!Array.isArray(roadLines) || roadLines.length !== 1 || !Array.isArray(roadLines[0]) || roadLines[0].length < 2) return null;
    const points = roadLines[0].map(pair => Array.isArray(pair) && pair.length >= 2 && validNumber(pair[0]) && validNumber(pair[1]) && Math.abs(pair[0]) <= 90 && Math.abs(pair[1]) <= 180 ? { lat: pair[0], lng: pair[1] } : null);
    if (points.some(p => !p)) return null;
    const offsets = [0];
    for (let i = 1; i < points.length; i++) offsets.push(offsets[i - 1] + haversine(points[i - 1], points[i]));
    const stationOffsets = [];
    let previous = -1;
    for (const stop of stops) {
      const candidates = [];
      for (let i = 0; i < points.length - 1; i++) {
        const p = project(stop, points[i], points[i + 1]);
        const at = offsets[i] + p.t * (offsets[i + 1] - offsets[i]);
        if (at >= previous + (stationOffsets.length ? 1 : 0)) candidates.push({ at, distance: p.distance });
      }
      candidates.sort((a, b) => a.distance - b.distance || a.at - b.at);
      if (!candidates.length || candidates[0].distance > 250) return null;
      if (candidates.length > 1 && candidates[1].distance <= candidates[0].distance + 5 && candidates[1].at - candidates[0].at > 100) return null;
      stationOffsets.push(candidates[0].at);
      previous = candidates[0].at;
    }
    if (stationOffsets.some((v, i) => i > 0 && v <= stationOffsets[i - 1])) return null;
    const base = stationOffsets[0], cumulative = stationOffsets.map(v => v - base), projectionSegments = [];
    for (let leg = 0; leg < stops.length - 1; leg++) {
      const lo = stationOffsets[leg], hi = stationOffsets[leg + 1];
      for (let i = 0; i < points.length - 1; i++) {
        const edgeLo = Math.max(lo, offsets[i]), edgeHi = Math.min(hi, offsets[i + 1]);
        if (edgeHi <= edgeLo) continue;
        const length = offsets[i + 1] - offsets[i];
        projectionSegments.push({ a: points[i], b: points[i + 1], leg, minT: (edgeLo - offsets[i]) / length, maxT: (edgeHi - offsets[i]) / length, offset: offsets[i] - base });
      }
    }
    return { cumulative, projectionSegments };
  }
  function create({ stops, boardingSeq, targetSeq, roadFactor = 1.25, roadLines } = {}) {
    if (!Array.isArray(stops) || stops.length < 2) throw new TypeError('stops must contain at least two ordered stops');
    if (!validNumber(roadFactor) || roadFactor < 1) throw new TypeError('roadFactor must be a finite number >= 1');
    const ordered = stops.map(s => ({ ...s })).sort((a, b) => a.seq - b.seq);
    if (ordered.some(s => !validNumber(s.seq) || !validNumber(s.lat) || !validNumber(s.lng) || s.lat < -90 || s.lat > 90 || s.lng < -180 || s.lng > 180)) throw new TypeError('each stop needs finite seq, lat, and lng coordinates');
    if (new Set(ordered.map(s => s.seq)).size !== ordered.length) throw new TypeError('stop seq values must be unique');
    const bi = ordered.findIndex(s => s.seq === boardingSeq), ti = ordered.findIndex(s => s.seq === targetSeq);
    if (bi < 0 || ti <= bi) throw new TypeError('boardingSeq and targetSeq must identify forward-ordered stops');
    const tripStops = ordered.slice(bi, ti + 1);
    let cumulative = [0];
    for (let i = 1; i < tripStops.length; i++) cumulative.push(cumulative[i - 1] + haversine(tripStops[i - 1], tripStops[i]));
    // Without a road shape, straight stop chords are only a route-length approximation;
    // roadFactor compensates roughly for road curvature, not the true road geometry.
    let geometrySource = 'stop-chord';
    let projectionSegments = tripStops.slice(0, -1).map((stop, i) => ({ a: stop, b: tripStops[i + 1], leg: i, minT: 0, maxT: 1, offset: cumulative[i] }));
    const road = roadGeometry(tripStops, roadLines);
    if (road) { cumulative = road.cumulative; projectionSegments = road.projectionSegments; geometrySource = 'road'; }
    const model = {
      tripStops, boardingSeq, targetSeq, roadFactor, cumulative, projectionSegments, geometrySource,
      samples: [], lastFix: null, lastProgress: 0, lastSegment: 0, confirmedIndex: 0,
      lastKnownSpeed: null
    };
    model.totalMeters = cumulative[cumulative.length - 1];
    return model;
  }
  function median(values) {
    if (!values.length) return null;
    const a = values.slice().sort((x, y) => x - y);
    return a[Math.floor((a.length - 1) / 2)];
  }
  function speedOf(model, now) {
    model.samples = model.samples.filter(s => now - s.at <= SAMPLE_WINDOW && now >= s.at);
    const speeds = model.samples.map(s => s.speed).filter(s => validNumber(s) && s >= 0 && s <= MAX_SPEED);
    if (!speeds.length) return null;
    // Lower median plus a conservative cap avoids optimistic ETAs from isolated fast samples.
    return Math.min(13.9, median(speeds));
  }
  function ingest(model, fix, now = Date.now()) {
    if (!model || !Array.isArray(model.tripStops)) return { accepted: false, reason: 'invalid-model' };
    if (!fix || !validNumber(fix.latitude) || !validNumber(fix.longitude) || fix.latitude < -90 || fix.latitude > 90 || fix.longitude < -180 || fix.longitude > 180) return { accepted: false, reason: 'invalid-coordinate' };
    if (!validNumber(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > MAX_ACCURACY) return { accepted: false, reason: 'poor-accuracy' };
    const stamp = fix.timestamp instanceof Date ? fix.timestamp.getTime() : (typeof fix.timestamp === 'string' ? Date.parse(fix.timestamp) : fix.timestamp);
    if (!validNumber(stamp)) return { accepted: false, reason: 'invalid-timestamp' };
    if (!validNumber(now) || stamp > now + FUTURE_TOLERANCE || now - stamp > FIX_MAX_AGE) return { accepted: false, reason: 'stale-or-future-fix' };
    if (model.lastFix && stamp <= model.lastFix.timestamp) return { accepted: false, reason: 'out-of-order-fix' };

    const point = { lat: fix.latitude, lng: fix.longitude };
    const deviationLimit = Math.min(MAX_DEVIATION, Math.max(45, fix.accuracy * 2));
    const last = model.lastFix;
    const candidates = [];
    // Cold start is deliberately confined to the boarding departure segment. Do not snap a
    // first fix on a repeated/overlapping route to an arbitrary downstream occurrence.
    for (const segment of model.projectionSegments) {
      const i = segment.leg;
      if (!last && i !== 0) continue;
      const raw = project(point, segment.a, segment.b);
      const t = Math.max(segment.minT, Math.min(segment.maxT, raw.t));
      const p = { t, distance: raw.distance };
      if (t !== raw.t) {
        const projectedPoint = { lat: segment.a.lat + (segment.b.lat - segment.a.lat) * t, lng: segment.a.lng + (segment.b.lng - segment.a.lng) * t };
        p.distance = haversine(point, projectedPoint);
      }
      if (p.distance > deviationLimit) continue;
      const along = segment.offset + p.t * haversine(segment.a, segment.b);
      if (!last && along > Math.max(500, fix.accuracy * 2)) continue;
      let penalty = 0;
      if (last) {
        const elapsed = (stamp - last.timestamp) / 1000;
        const rawDistance = haversine(last, point);
        const allowed = Math.max(350, elapsed * 45 + 150);
        if (rawDistance > allowed) continue;
        if (Math.abs(along - model.lastProgress) > Math.max(1200, elapsed * 45 + 250)) continue;
        // Prefer continuity, but permit genuine backward correction and repeated spatial locations.
        const delta = along - model.lastProgress;
        penalty = Math.abs(delta) * 0.035 + (delta < -EPSILON ? 300 : 0);
      }
      candidates.push({ index: i, along, distance: p.distance, score: p.distance + penalty });
    }
    if (!candidates.length) return { accepted: false, reason: last ? 'off-route-or-implausible-jump' : 'not-near-boarding-segment' };
    candidates.sort((a, b) => a.score - b.score || a.index - b.index);
    const chosen = candidates[0];
    const elapsed = last ? (stamp - last.timestamp) / 1000 : 0;
    if (last && elapsed > 0) {
      const routeDelta = Math.abs(chosen.along - model.lastProgress);
      const observed = routeDelta / elapsed;
      if (observed > MAX_SPEED) return { accepted: false, reason: 'implausible-route-speed' };
      model.samples.push({ at: stamp, speed: observed >= 0.35 ? observed : 0 });
    }
    if (validNumber(fix.speed) && fix.speed >= 0 && fix.speed <= MAX_SPEED) {
      // Device speed is useful when moving, but an explicit near-zero reading records a stop.
      model.samples.push({ at: stamp, speed: fix.speed });
    }
    const currentSpeeds = model.samples.filter(s => stamp - s.at <= SAMPLE_WINDOW && stamp >= s.at).map(s => s.speed).filter(s => s >= 0 && s <= MAX_SPEED);
    if (currentSpeeds.length) model.lastKnownSpeed = Math.min(13.9, median(currentSpeeds));
    model.lastFix = { ...point, timestamp: stamp, accuracy: fix.accuracy, segmentIndex: chosen.index };
    model.lastProgress = Math.max(0, Math.min(model.totalMeters, chosen.along));
    model.lastSegment = chosen.index;
    const crossed = model.cumulative.findLastIndex ? model.cumulative.findLastIndex((m, i) => i <= model.tripStops.length - 1 && m <= model.lastProgress + EPSILON) : (() => { let j = 0; for (let i = 0; i < model.cumulative.length; i++) if (model.cumulative[i] <= model.lastProgress + EPSILON) j = i; return j; })();
    // Current trusted GPS can correct a prior estimate in either direction.
    model.confirmedIndex = Math.max(0, crossed);
    return { accepted: true, reason: 'trusted-gps', seq: model.tripStops[model.confirmedIndex].seq, progress: model.totalMeters ? model.lastProgress / model.totalMeters : 0 };
  }
  function snapshot(model, now = Date.now()) {
    if (!model || !Array.isArray(model.tripStops)) return { status: 'waiting', confidence: 'low', seq: null, nextSeq: null, boardingSeq: null, targetSeq: null, progress: 0, remainingStops: 0, elapsedSinceFix: null, reason: 'invalid-model', speedMps: null, estimatedWindowSeconds: 0, segmentMeters: null };
    if (!model.lastFix) return blank(model, now, 'awaiting-first-trusted-fix');
    const elapsed = Math.max(0, (now - model.lastFix.timestamp) / 1000);
    const motionSpeed = speedOf(model, now) ?? model.lastKnownSpeed;
    const speed = motionSpeed ?? 0;
    let status = 'gps', confidence = 'high', reason = 'trusted-gps', routeMeters = model.lastProgress;
    const firstNext = Math.min(model.tripStops.length - 1, model.confirmedIndex + 1);
    let windowSeconds = motionSpeed === null ? 0 : Math.min(MAX_ESTIMATE_MS / 1000, Math.max(120, Math.max(0, model.cumulative[firstNext] - model.lastProgress) / Math.max(motionSpeed, 0.5) + 120));
    if (elapsed > LOST_SIGNAL_MS / 1000) {
      confidence = 'low';
      if (motionSpeed === null) {
        status = 'paused'; reason = 'no-recent-speed-history';
      } else {
        const nextIdx = Math.min(model.tripStops.length - 1, model.confirmedIndex + 1);
        const distanceToNext = Math.max(0, model.cumulative[nextIdx] - model.lastProgress);
        windowSeconds = Math.min(MAX_ESTIMATE_MS / 1000, Math.max(120, distanceToNext / Math.max(motionSpeed, 0.5) + 120));
        if (elapsed > windowSeconds) {
          status = 'paused'; reason = 'estimate-window-expired';
          routeMeters = Math.min(model.lastProgress + motionSpeed * windowSeconds, Math.max(model.lastProgress, model.cumulative[nextIdx] - 1));
        } else {
          status = 'estimated'; reason = 'dead-reckoning-unconfirmed';
          routeMeters = Math.min(model.lastProgress + motionSpeed * elapsed, Math.max(model.lastProgress, model.cumulative[nextIdx] - 1));
          if (routeMeters >= model.cumulative[nextIdx] - 1) { status = 'paused'; reason = 'paused-before-unconfirmed-stop'; }
        }
      }
    }
    const nextIdx = Math.min(model.tripStops.length - 1, model.confirmedIndex + 1);
    const nextSeq = model.confirmedIndex >= model.tripStops.length - 1 ? null : model.tripStops[nextIdx].seq;
    const progress = model.totalMeters > 0 ? Math.max(0, Math.min(1, routeMeters / model.totalMeters)) : 0;
    const remainingStops = Math.max(0, model.tripStops.length - 1 - model.confirmedIndex);
    const segmentMeters = model.confirmedIndex >= model.tripStops.length - 1 ? 0 : Math.max(0, (model.cumulative[nextIdx] - routeMeters) * (model.geometrySource === 'road' ? 1 : model.roadFactor));
    return {
      status, confidence, seq: model.tripStops[model.confirmedIndex].seq, nextSeq,
      boardingSeq: model.boardingSeq, targetSeq: model.targetSeq, progress,
      remainingStops, elapsedSinceFix: elapsed, reason,
      speedMps: speed, estimatedWindowSeconds: windowSeconds,
      segmentMeters, geometrySource: model.geometrySource
    };
  }

  root.BusTripProgress = Object.freeze({ create, ingest, snapshot });
})(typeof globalThis !== 'undefined' ? globalThis : this);
