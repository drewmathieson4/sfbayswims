import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 45000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:8765', headless: true, channel: process.env.CI ? undefined : 'chrome' },
  webServer: { command: 'python3 -B tests/browser/serve.py', url: 'http://127.0.0.1:8765', reuseExistingServer: false },
});
