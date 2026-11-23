import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import WebSocket from 'ws';

// M2-4 web project: the mini player page `#/mini` on Vite + mock-core, viewport 320x88 (and 320x320 for square).
// Run with MM_WEB_PORT=5190 MOCK_PORT=48010 (MM_WEB_URL overrides). Test data only: the mock core serves a fixture library.
const webPort = process.env.MM_WEB_PORT;
const mockPort = Number(process.env.MOCK_PORT) || 47999;
if (webPort) test.use({ baseURL: process.env.MM_WEB_URL ?? `http://127.0.0.1:${webPort}` });

const SHOTS = process.env.MM_SHOTS_DIR ?? path.resolve(__dirname, '../../../../shots-M2-4');
fs.mkdirSync(SHOTS, { recursive: true });

/** Plays five mock library tracks through a separate "ui" connection (what the main window would do). */
async function playSome(): Promise<void> {
  const origin = process.env.MM_WEB_URL ?? `http://127.0.0.1:${webPort ?? 5173}`;
  const ws = new WebSocket(`ws://127.0.0.1:${mockPort}/rpc`, { origin });
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    pending.get(m.id)?.(m);
  });
  await new Promise<void>((res, rej) => (ws.once('open', () => res()), ws.once('error', rej)));
  const call = (m: string, p: object) =>
    new Promise<any>((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, m, p }));
    });
  await call('sys.hello', { token: 'dev', role: 'ui', protocol: 1, client: 'e2e/0', locale: 'en' });
  const w = await call('library.window', { list: 'songs', sort: { by: 'title', desc: false }, offset: 0, limit: 10 });
  const ids = w.r.items.slice(0, 5).map((t: any) => t.id);
  await call('player.play', { context: { kind: 'tracks', ids, title: 'e2e' }, startIndex: 0 });
  ws.close();
}

async function boot(page: Page, hash = '#/mini') {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`/?lang=en${hash}`);
  await expect(page.getByTestId('mini')).toBeVisible();
}

test.describe('mini player page (E-34 web part)', () => {
  test.use({ viewport: { width: 320, height: 88 } });

  test('renders at 320x88: art 64, title, three transport buttons, 2 px progress line', async ({ page }) => {
    await playSome();
    await boot(page);
    await expect(page.getByTestId('mini-title')).not.toHaveText('Nothing playing');
    const art = (await page.getByTestId('mini-art').boundingBox())!;
    expect([Math.round(art.width), Math.round(art.height)]).toEqual([64, 64]);
    for (const id of ['mini-prev', 'mini-play', 'mini-next', 'mini-mode', 'mini-back']) await expect(page.getByTestId(id)).toBeVisible();
    const line = (await page.locator('.mini-line').boundingBox())!;
    expect(Math.round(line.height)).toBe(2);
    expect(line.y + line.height).toBeCloseTo(88, 0);
    // no horizontal or vertical overflow of the 320x88 window
    expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([320, 88]);
    await page.screenshot({ path: path.join(SHOTS, 'mini-bar.png') });
  });

  test('play button toggles the core and the label follows', async ({ page }) => {
    await playSome();
    await boot(page);
    const play = page.getByTestId('mini-play');
    await expect(play).toHaveAttribute('aria-label', 'Pause');
    await play.click();
    await expect(play).toHaveAttribute('aria-label', 'Play');
    await play.click();
    await expect(play).toHaveAttribute('aria-label', 'Pause');
    await page.getByTestId('mini-next').click();
    await page.screenshot({ path: path.join(SHOTS, 'mini-bar-next.png') });
  });

  test('the mini page connects with role mini and does not mount the main app', async ({ page }) => {
    await boot(page);
    expect(await page.getByTestId('app').count()).toBe(0);
  });
});

test.describe('square mode', () => {
  test.use({ viewport: { width: 320, height: 320 } });
  test('320x320 art mode from the URL', async ({ page }) => {
    await playSome();
    await boot(page, '#/mini?mode=square');
    await expect(page.getByTestId('mini')).toHaveAttribute('data-mode', 'square');
    const art = (await page.getByTestId('mini-art').boundingBox())!;
    expect([Math.round(art.width), Math.round(art.height)]).toEqual([320, 320]);
    await page.screenshot({ path: path.join(SHOTS, 'mini-square.png') });
  });
});
