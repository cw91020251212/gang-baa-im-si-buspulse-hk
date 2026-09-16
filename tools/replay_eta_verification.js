#!/usr/bin/env node
/* Replay BusPulse ETA snapshots exported with window.exportEtaVerification(). */
const fs = require('fs');
const input = process.argv[2];
if (!input) { console.error('用法：node tools/replay_eta_verification.js <export.json>'); process.exit(2); }
const all = JSON.parse(fs.readFileSync(input, 'utf8'));
const rad = Math.PI / 180;
function distance(a, b) {
  const values = [a.lat, a.lng, b.lat, b.lng].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [lat1, lon1, lat2, lon2] = values;
  const dLat = (lat2-lat1)*rad, dLon = (lon2-lon1)*rad;
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}
function estimate(rows, {bufferMs=60000, expectedSpeedMps=8, toleranceRatio=.25}={}) {
  const bySeq = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const seq = Number(row?.seq), time = Date.parse(row?.eta || row?.iso || '');
    if (!Number.isFinite(seq) || !Number.isFinite(time) || Number(row?.eta_seq ?? 1) !== 1) continue;
    const old = bySeq.get(seq);
    if (!old || time < old.time) bySeq.set(seq, {seq,time,lat:Number(row.lat),lng:Number(row.lng)});
  }
  const points = [...bySeq.values()].sort((a,b)=>a.seq-b.seq);
  if (!points.length) return {count:0,drops:0,samples:0,distanceMeters:0};
  let count=1,drops=0,previous=points[0].time,distanceMeters=0;
  for (let i=1;i<points.length;i++) {
    const row=points[i], d=distance(points[i-1],row);
    if (Number.isFinite(d)) distanceMeters += d;
    const allowance=Number.isFinite(d) ? d/expectedSpeedMps*1000*toleranceRatio : 0;
    const threshold=Math.max(bufferMs,allowance);
    if (row.time < previous-threshold) { count++; drops++; }
    previous=row.time;
  }
  return {count,drops,samples:points.length,distanceMeters:Math.round(distanceMeters)};
}
for (const [route, snapshots] of Object.entries(all)) {
  console.log(`\n${route}`);
  console.log('時間\t估算波段\t回流\t有效站數\t距離(m)');
  for (const snapshot of (snapshots || [])) {
    const r=estimate(snapshot.rows);
    console.log(`${snapshot.at}\t${r.count}\t${r.drops}\t${r.samples}\t${r.distanceMeters}`);
  }
}
