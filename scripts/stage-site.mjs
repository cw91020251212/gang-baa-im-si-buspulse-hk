import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { CESIUM_VERSION } from '../landsd-3d-runtime.js';
const files = ['index.html', 'bus-gap-estimator.js', 'trip-progress.js', 'trip-progress-ui.js', 'trip-progress.css', 'landsd-map-compare.html', 'landsd-map-compare.js', 'landsd-map-provider.js', 'landsd-map-provider.css', 'landsd-3d-map.js', 'landsd-3d-map.css', 'landsd-3d-runtime.js', 'scene3d.js', 'manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png', 'route-location-icon-v6.png', 'fare-index.json', 'place-index.json'];
for (const file of [...files, 'assets/landsd-logo.png', `vendor/cesium/${CESIUM_VERSION}/Cesium.js`, `vendor/cesium/${CESIUM_VERSION}/ThirdParty/basis_transcoder.wasm`]) {
  if (!existsSync(file)) throw new Error(`Required runtime asset missing: ${file}`);
}
rmSync('_site', { recursive: true, force: true });
mkdirSync('_site/assets', { recursive: true });
for (const file of files) cpSync(file, `_site/${file}`);
cpSync('assets/landsd-logo.png', '_site/assets/landsd-logo.png');
mkdirSync('_site/vendor/cesium', { recursive: true });
cpSync(`vendor/cesium/${CESIUM_VERSION}`, `_site/vendor/cesium/${CESIUM_VERSION}`, { recursive: true });
if (existsSync('_site/node_modules') || existsSync('_site/tests')) throw new Error('Development files leaked into runtime site');
console.log(`Staged ${files.length} app assets and fixed Cesium ${CESIUM_VERSION} SDK for Pages`);
