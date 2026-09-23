import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BUSPULSE_BASE_URL || 'http://127.0.0.1:4179',
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'python3 -m http.server 4179 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4179/index.html',
    reuseExistingServer: true,
    timeout: 10_000
  }
});
