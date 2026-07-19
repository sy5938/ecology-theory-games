import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './prototype-v2/tests/browser',
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1600, height: 1000 },
  },
  webServer: {
    command: 'npm run demo -- --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
  },
})
