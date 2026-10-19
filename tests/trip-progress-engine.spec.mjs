import { test, expect } from '@playwright/test';
import '../trip-progress.js';

const engine = globalThis.BusTripProgress;
const t0 = Date.parse('2026-10-20T00:00:00Z');
const point = (metres, lng = 0) => ({ latitude: metres / 111195, longitude: lng, accuracy: 8 });
function route(distances, { lngs, seqs } = {}) {
  return distances.map((m, i) => ({ id: `S${i}`, seq: seqs?.[i] ?? i + 1, name: `Stop ${i}`, lat: m / 111195, lng: lngs?.[i] ?? 0 }));
}
function model(distances, opts = {}) {
  const stops = route(distances, opts);
  return engine.create({ stops, boardingSeq: stops[0].seq, targetSeq: stops.at(-1).seq, ...opts.create });
}
function fix(atMeters, time = t0, extra = {}) {
  return { ...point(atMeters), timestamp: time, ...extra };
}

test('exports a global API and accepts valid zero latitude/longitude', () => {
  expect(engine).toMatchObject({ create: expect.any(Function), ingest: expect.any(Function), snapshot: expect.any(Function) });
  const m = model([0, 1000]);
  expect(engine.ingest(m, fix(0), t0).accepted).toBe(true);
  expect(engine.snapshot(m, t0).status).toBe('gps');
});

test('cold start is limited to the boarding segment and rejects missing/NaN coordinates', () => {
  const m = model([0, 1000, 2000, 3000]);
  expect(engine.ingest(m, { latitude: NaN, longitude: 0, accuracy: 5, timestamp: t0 }, t0).accepted).toBe(false);
  expect(engine.ingest(m, { longitude: 0, accuracy: 5, timestamp: t0 }, t0).accepted).toBe(false);
  expect(engine.ingest(m, fix(1500), t0)).toMatchObject({ accepted: false, reason: 'not-near-boarding-segment' });
  expect(engine.ingest(m, fix(200), t0).accepted).toBe(true);
});

test('10 km gap can be conservatively estimated after a five-minute signal loss', () => {
  const m = model([0, 10000]);
  expect(engine.ingest(m, fix(0, t0, { speed: 10 }), t0).accepted).toBe(true);
  const s = engine.snapshot(m, t0 + 5 * 60_000);
  expect(s.status).toBe('estimated');
  expect(s.confidence).toBe('low');
  expect(s.progress).toBeGreaterThan(0.25);
  expect(s.seq).toBe(1); // time alone never confirms a stop crossing
  expect(s.estimatedWindowSeconds).toBeLessThanOrEqual(1200);
});

test('stationary vehicle remains stationary instead of inventing movement', () => {
  const m = model([0, 1000]);
  engine.ingest(m, fix(0, t0, { speed: 0 }), t0);
  const s = engine.snapshot(m, t0 + 90_000);
  expect(s.status).toBe('estimated');
  expect(s.progress).toBe(0);
  expect(s.speedMps).toBe(0);
});

test('without usable speed history, loss of signal pauses rather than fabricating an ETA', () => {
  const m = model([0, 1000]);
  engine.ingest(m, fix(0), t0);
  const s = engine.snapshot(m, t0 + 25_000);
  expect(s.status).toBe('paused');
  expect(s.speedMps).toBe(0);
  expect(s.progress).toBe(0);
});

test('out-of-order and stale fixes are rejected without changing the current position', () => {
  const m = model([0, 1000]);
  engine.ingest(m, fix(100, t0), t0);
  expect(engine.ingest(m, fix(300, t0 - 121_000), t0).reason).toBe('stale-or-future-fix');
  expect(engine.ingest(m, fix(300, t0 + 1), t0 + 200_000).reason).toBe('stale-or-future-fix');
  expect(engine.snapshot(m, t0).progress).toBeLessThan(0.2);
});

test('poor accuracy and excessive route deviation are rejected', () => {
  const m = model([0, 1000]);
  expect(engine.ingest(m, fix(0, t0, { accuracy: 101 }), t0).reason).toBe('poor-accuracy');
  expect(engine.ingest(m, { latitude: 0, longitude: 0.01, accuracy: 10, timestamp: t0 }, t0).accepted).toBe(false);
});

test('trusted GPS can correct estimated position backwards', () => {
  const m = model([0, 1000, 2000]);
  engine.ingest(m, fix(0, t0, { speed: 8 }), t0);
  const estimated = engine.snapshot(m, t0 + 40_000);
  expect(estimated.progress).toBeGreaterThan(0);
  expect(engine.ingest(m, fix(100, t0 + 41_000), t0 + 41_000).accepted).toBe(true);
  const corrected = engine.snapshot(m, t0 + 41_000);
  expect(corrected.status).toBe('gps');
  expect(corrected.progress).toBeLessThan(estimated.progress);
});

test('dead reckoning stops before a station and never declares estimated arrival', () => {
  const m = model([0, 100]);
  engine.ingest(m, fix(0, t0, { speed: 10 }), t0);
  const s = engine.snapshot(m, t0 + 30_000);
  expect(['paused', 'estimated']).toContain(s.status);
  expect(s.progress).toBeLessThan(1);
  expect(s.seq).toBe(1);
  expect(s.remainingStops).toBe(1);
});

test('continuous GPS across several stops advances seq by crossed stops, not nearest stop', () => {
  const m = model([0, 500, 1000, 1500]);
  engine.ingest(m, fix(0, t0), t0);
  expect(engine.ingest(m, fix(1200, t0 + 180_000), t0 + 180_000).accepted).toBe(true);
  const s = engine.snapshot(m, t0 + 180_000);
  expect(s.seq).toBe(3);
  expect(s.nextSeq).toBe(4);
  expect(s.remainingStops).toBe(1);
});

test('roadFactor scales approximate segment distance, not geometric progress', () => {
  const normal = model([0, 1000], { create: { roadFactor: 1 } });
  const curvedRoadApprox = model([0, 1000], { create: { roadFactor: 1.5 } });
  engine.ingest(normal, fix(0), t0);
  engine.ingest(curvedRoadApprox, fix(0), t0);
  const a = engine.snapshot(normal, t0), b = engine.snapshot(curvedRoadApprox, t0);
  expect(b.segmentMeters).toBeCloseTo(a.segmentMeters * 1.5, 1);
  expect(b.progress).toBe(a.progress);
});

test('a safe continuous road line supplies curved projection and real distance without roadFactor inflation', () => {
  const stops = [
    { id: 'A', seq: 1, lat: 0, lng: 0 },
    { id: 'B', seq: 2, lat: 0, lng: 0.02 }
  ];
  const roadLines = [[[0, 0], [0.01, 0], [0.01, 0.02], [0, 0.02]]];
  const m = engine.create({ stops, boardingSeq: 1, targetSeq: 2, roadFactor: 1.5, roadLines });
  expect(engine.ingest(m, { latitude: 0, longitude: 0, accuracy: 8, timestamp: t0 }, t0).accepted).toBe(true);
  const s = engine.snapshot(m, t0);
  expect(s.geometrySource).toBe('road');
  expect(s.segmentMeters).toBeGreaterThan(4300);
  expect(s.segmentMeters).toBeLessThan(4500); // ~4.45 km line, not chord * roadFactor
  expect(engine.ingest(m, { latitude: 0.01, longitude: 0.01, accuracy: 8, timestamp: t0 + 120_000 }, t0 + 120_000).accepted).toBe(true);
  expect(engine.snapshot(m, t0 + 120_000).progress).toBeGreaterThan(0.45);
  expect(engine.snapshot(m, t0 + 120_000).progress).toBeLessThan(0.55);
});

test('multipart road lines are not bridged and exact GPS at the target confirms it', () => {
  const stops = route([0, 1000]);
  const m = engine.create({ stops, boardingSeq: 1, targetSeq: 2, roadLines: [[[0, 0], [0.004, 0]], [[0.005, 0], [0.009, 0]]] });
  expect(engine.ingest(m, fix(0), t0).accepted).toBe(true);
  expect(engine.snapshot(m, t0).geometrySource).toBe('stop-chord');
  expect(engine.ingest(m, fix(1000, t0 + 120_000), t0 + 120_000).accepted).toBe(true);
  expect(engine.snapshot(m, t0 + 120_000)).toMatchObject({ seq: 2, nextSeq: null, progress: 1, remainingStops: 0 });
});

test('loop/repeated coordinates prefer the current forward occurrence rather than jumping to the end', () => {
  const stops = [
    { id: 'A', seq: 1, lat: 0, lng: 0 },
    { id: 'B', seq: 2, lat: 0.0045, lng: 0 },
    { id: 'C', seq: 3, lat: 0.0045, lng: 0.0045 },
    { id: 'D', seq: 4, lat: 0, lng: 0 }, // same coordinate as boarding, but a later loop occurrence
    { id: 'E', seq: 5, lat: -0.0045, lng: 0 }
  ];
  const m = engine.create({ stops, boardingSeq: 1, targetSeq: 5 });
  engine.ingest(m, { latitude: 0, longitude: 0, accuracy: 5, timestamp: t0 }, t0);
  expect(engine.snapshot(m, t0).progress).toBe(0);
  // At repeated coordinates after traversing the loop, continuity retains the later occurrence.
  expect(engine.ingest(m, { latitude: 0.0045, longitude: 0, accuracy: 5, timestamp: t0 + 120_000 }, t0 + 120_000).accepted).toBe(true);
  expect(engine.ingest(m, { latitude: 0, longitude: 0, accuracy: 5, timestamp: t0 + 300_000 }, t0 + 300_000).accepted).toBe(true);
  expect(engine.snapshot(m, t0 + 300_000).seq).toBe(4);
});

test('GPS recovery may cover a long distance when elapsed-time speed remains plausible', () => {
  const m = model([0, 10000]);
  engine.ingest(m, fix(0, t0), t0);
  const recovered = engine.ingest(m, fix(9000, t0 + 15 * 60_000), t0 + 15 * 60_000);
  expect(recovered.accepted).toBe(true);
  expect(engine.snapshot(m, t0 + 15 * 60_000).progress).toBeGreaterThan(0.85);
});
