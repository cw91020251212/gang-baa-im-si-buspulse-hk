import base from './playwright.config.mjs';
// Legacy map/smoke fixtures explicitly allow 4179. Never reuse another project's server.
export default {
  ...base,
  outputDir:'test-results-trip-local',
  use:{...base.use, baseURL:'http://127.0.0.1:4179'},
  webServer:{command:'python3 -m http.server 4179 --bind 127.0.0.1',url:'http://127.0.0.1:4179/index.html',reuseExistingServer:false,timeout:10000}
};
