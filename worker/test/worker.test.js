import test from 'node:test';
import assert from 'node:assert/strict';
import { dueETA, parseETAs } from '../src/index.js';

test('dueETA selects earliest ETA inside lead window and supports late catch-up', () => {
  const now = Date.parse('2026-10-17T10:05:00Z');
  assert.equal(dueETA([{iso:'2026-10-17T10:01:00Z'},{iso:'2026-10-17T10:04:00Z'}], now, 2).iso, '2026-10-17T10:01:00Z');
});
test('KMB filters route ETA by exact direction and stop sequence', () => {
  const it = { co:'KMB', route:'74X', dir:'I', seq:7 };
  const rows = parseETAs(it,{data:[{seq:7,dir:'O',eta:'2026-10-17T10:01:00Z'},{seq:7,dir:'I',eta:'2026-10-17T10:02:00Z'},{seq:8,dir:'I',eta:'2026-10-17T10:03:00Z'}]});
  assert.deepEqual(rows.map(x=>x.iso), ['2026-10-17T10:02:00Z']);
});
test('CTB filters by direction and stop', () => {
  const it = { co:'CTB', dir:'O', stopId:'s1' };
  const rows = parseETAs(it,{data:[{dir:'I',stop:'s1',eta:'2026-10-17T10:01:00Z'},{dir:'O',stop:'s2',eta:'2026-10-17T10:02:00Z'},{dir:'O',stop:'s1',eta:'2026-10-17T10:03:00Z'}]});
  assert.deepEqual(rows.map(x=>x.iso), ['2026-10-17T10:03:00Z']);
});
test('GMB parses ETA rows without mixing another route direction', () => {
  const rows = parseETAs({co:'GMB'}, {data:[{eta:[{timestamp:'2026-10-17T10:01:00Z'}]}]});
  assert.equal(rows.length, 1);
});
test('dueETA rejects buses outside the catch-up window', () => {
  const now = Date.parse('2026-10-17T10:00:00Z');
  assert.equal(dueETA([{iso:'2026-10-17T09:00:00Z'}], now, 2), null);
});
