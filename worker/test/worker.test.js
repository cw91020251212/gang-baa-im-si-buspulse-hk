import test from 'node:test';
import assert from 'node:assert/strict';
import { dueETA } from '../src/index.js';

test('dueETA selects the earliest ETA inside the lead window', () => {
  const now = Date.parse('2026-09-08T10:00:00Z');
  const eta = dueETA([
    { iso: '2026-09-08T10:04:00Z' },
    { iso: '2026-09-08T10:01:00Z' },
    { iso: '2026-09-08T10:05:00Z' }
  ], now, 2);
  assert.equal(eta.iso, '2026-09-08T10:01:00Z');
});

test('dueETA still accepts a slightly late wake-up', () => {
  const now = Date.parse('2026-09-08T10:03:00Z');
  const eta = dueETA([{ iso: '2026-09-08T10:01:00Z' }], now, 2);
  assert.equal(eta.iso, '2026-09-08T10:01:00Z');
});

test('dueETA ignores buses outside the alert window', () => {
  const now = Date.parse('2026-09-08T10:00:00Z');
  assert.equal(dueETA([{ iso: '2026-09-08T10:03:00Z' }], now, 2), null);
  assert.equal(dueETA([{ iso: '2026-09-08T09:57:00Z' }], now, 2), null);
});
