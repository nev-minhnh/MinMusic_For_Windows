import { defineConfig } from '@playwright/test';

// Projects (test-guide section 4):
//   web : Chromium against the Vite dev server + mock-core (fast, every UI change)
//   app : attached over CDP to the real app (WebView2); scripts/e2e.ps1 starts it and sets MM_CDP_ENDPOINT
// Ports: every WP has its own pair (waves.md). MM_WEB_PORT = Vite, MOCK_PORT = mock core.
// The servers are never shared: reuseExistingServer only when MM_REUSE=1.
const webPort = Number(process.env.MM_WEB_PORT) || 5173;
const mockPort = Number(process.env.MOCK_PORT) || 47999;
const webUrl = process.env.MM_WEB_URL ?? `http://127.0.0.1:${webPort}`;
const reuse = process.env.MM_REUSE === '1';
const viteCore = JSON.stringify({ port: mockPort, token: 'dev', artToken: 'devart' });

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
  // Only used by the web project.
  webServer: process.env.MM_NO_WEBSERVER
    ? undefined
    : [
        {
          command: 'node mock-core/bin/dev.mjs', port: mockPort, reuseExistingServer: reuse, timeout: 30_000,
          env: { MOCK_PORT: String(mockPort), MM_WEB_PORT: String(webPort) },
        },
        {
          command: `node node_modules/vite/bin/vite.js ui --host 127.0.0.1 --port ${webPort} --strictPort`, url: webUrl, reuseExistingServer: reuse, timeout: 60_000,
          env: { VITE_MM_CORE: viteCore, MM_WEB_PORT: String(webPort) },
        },
      ],
});
