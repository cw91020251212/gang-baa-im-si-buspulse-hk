import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve('node_modules/cesium');
const version = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')).version;
const source = resolve(packageRoot, 'Build/Cesium');
const target = resolve('vendor/cesium', version);
const files = ['Cesium.js', 'Assets', 'ThirdParty', 'Widgets', 'Workers'];
const licenses = ['LICENSE.md', 'ThirdParty.json', 'ThirdParty.extra.json'];
const marker = resolve(target, 'sdk-version.json');
let prepared = false;
try { const state = JSON.parse(readFileSync(marker, 'utf8')); prepared = state.version === version && state.assetLayoutRevision === 1 && [...files, ...licenses].every(name => existsSync(resolve(target, name))); } catch { /* Prepare a new or incomplete SDK. */ }
if (prepared) console.log(`Versioned Cesium ${version} SDK already prepared`);
else {
  if (!existsSync(resolve(source, 'Cesium.js'))) throw new Error('Installed Cesium standalone SDK is missing');
  mkdirSync(target, { recursive: true });
  for (const name of files) cpSync(resolve(source, name), resolve(target, name), { recursive: true });
  for (const name of licenses) cpSync(resolve(packageRoot, name), resolve(target, name));
  writeFileSync(marker, JSON.stringify({ version, assetLayoutRevision: 1 }) + '\n');
  console.log(`Prepared Cesium ${version} SDK, assets, workers and licenses for Pages`);
}
