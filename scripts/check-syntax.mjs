import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { spawnSync } from 'node:child_process';
const html = readFileSync('index.html', 'utf8');
let count = 0;
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc\s*=|type\s*=\s*["'](?:importmap|module)/i.test(match[1]) || !match[2].trim()) continue;
  new Script(match[2], { filename: `index.html:inline-${++count}` });
}
for (const file of ['landsd-map-provider.js', 'landsd-3d-map.js', 'map-fullscreen.js', 'landsd-3d-runtime.js', 'scene3d.js', 'landsd-map-compare.js', 'sw.js', 'bus-gap-estimator.js', 'trip-progress.js', 'trip-progress-ui.js']) {
  const checked = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (checked.status !== 0) process.exit(checked.status || 1);
}
console.log(`BusPulse inline scripts (${count}) and runtime JavaScript syntax OK`);
