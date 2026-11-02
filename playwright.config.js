import { defineConfig } from '@playwright/test';
import { browserOptions } from './scripts/browser-runtime.mjs';

export default defineConfig({
  testDir: './test/browser',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: 'list',
  use: {
    browserName: 'chromium',
    launchOptions: await browserOptions(),
    viewport: { width: 1440, height: 960 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
