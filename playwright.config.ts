import { defineConfig } from '@playwright/test';

// Projects (test-guide section 4):
//   web : Chromium against the Vite dev server + mock-core (fast, every UI change)
//   app : attached over CDP to the real app (WebView2); scripts/e2e.ps1 starts it and sets MM_CDP_ENDPOINT
const webUrl = process.env.MM_WEB_URL ?? 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__screens__/{projectName}/{testFilePath}/{arg}{ext}',
  projects: [
    { name: 'web', testMatch: /web\/.*\.spec\.ts/, use: { baseURL: webUrl, browserName: 'chromium' } },
    { name: 'app', testMatch: /app\/.*\.spec\.ts/, use: {} },
  ],
  // Only used by the web project when no server is already listening.
  webServer: process.env.MM_NO_WEBSERVER
    ? undefined
    : [
        { command: 'node mock-core/bin/dev.mjs', port: 47999, reuseExistingServer: true, timeout: 30_000 },
        { command: 'npm --prefix ui run dev -- --host 127.0.0.1 --port 5173', url: webUrl, reuseExistingServer: true, timeout: 60_000 },
      ],
});
