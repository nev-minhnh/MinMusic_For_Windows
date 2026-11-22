import { test as base, chromium, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Fixture for the `app` project: connectOverCDP to the real app started by scripts/e2e.ps1.
// Exposes invoke(cmd,args) (Tauri command) and shot(name) (CDP Page.captureScreenshot only; no GDI/PrintWindow).
type AppFixtures = {
  app: {
    browser: Browser;
    page: Page;
    invoke: <T = unknown>(cmd: string, args?: object) => Promise<T>;
    shot: (name: string) => Promise<string>;
  };
};

export const test = base.extend<AppFixtures>({
  app: async ({}, use) => {
    const endpoint = process.env.MM_CDP_ENDPOINT;
    if (!endpoint) throw new Error('MM_CDP_ENDPOINT not set: run through scripts/e2e.ps1');
    const browser = await chromium.connectOverCDP(endpoint);
    const pages = browser.contexts().flatMap((c) => c.pages());
    // main window = the page that is NOT the mini player (#/mini)
    const page = pages.find((p) => !/#\/mini/.test(p.url()) && !p.url().startsWith('devtools:'));
    if (!page) throw new Error('main window page not found; pages: ' + pages.map((p) => p.url()).join(', '));
    const shotsDir = process.env.MM_SHOTS_DIR ?? path.join('.testdata', process.env.MM_RUN_ID ?? 'adhoc', 'shots');
    fs.mkdirSync(shotsDir, { recursive: true });
    const session = await page.context().newCDPSession(page);
    await use({
      browser,
      page,
      invoke: (cmd, args = {}) =>
        page.evaluate(([c, a]) => (window as any).__TAURI__.core.invoke(c, a), [cmd, args] as const) as Promise<any>,
      shot: async (name) => {
        const r = await session.send('Page.captureScreenshot', { format: 'png' });
        const file = path.join(shotsDir, `${name}.png`);
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        return file;
      },
    });
    await session.detach().catch(() => {});
    await browser.close().catch(() => {}); // detaches only; the app keeps running
  },
});
export { expect } from '@playwright/test';
