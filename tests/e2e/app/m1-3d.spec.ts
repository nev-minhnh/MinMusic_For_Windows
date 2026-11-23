import { test, expect } from '../fixtures/app';
import fs from 'node:fs';
import path from 'node:path';

// M1-3d, app project (WebView2 over CDP, run by integration against the real core). NOT run by the WP: build policy.
// Live ids come from tests/contract/fixtures/live-ids.json (long-lived official YouTube Music ids).
// Pages are opened through the Tauri event `mm-nav` (the same path a deep link takes), so no dev seam is needed.
const ids = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../contract/fixtures/live-ids.json'), 'utf8'));
const ALBUM: string = ids.album.id;
const ARTIST: string = ids.artist.id;
const PLAYLIST: string = ids.playlist.id;

type App = Parameters<Parameters<typeof test>[2]>[0]['app'];
const nav = (app: App, route: string, params: Record<string, string>) =>
  app.page.evaluate(([r, p]) => (window as any).__TAURI__.event.emit('mm-nav', { route: r, params: p }), [route, params] as const);
// the app is shared across tests and keeps visited pages alive (hidden): scope every locator to the page on screen
const current = (app: App) => app.page.locator('.pg:not(.hid)');

test('app E-4: Album > Artist > Back > Back with Alt+Left and the title-bar arrow, pages stay alive', async ({ app }) => {
  await nav(app, 'album', { id: ALBUM });
  await expect(app.page.getByTestId('coll-title')).toBeVisible({ timeout: 30_000 });
  await nav(app, 'artist', { id: ARTIST });
  await expect(app.page.getByTestId('artist-name')).toContainText(ids.artist.name.slice(0, 4), { timeout: 30_000 });
  await app.shot('m1-3d-artist-live');
  await app.page.keyboard.press('Alt+ArrowLeft');
  await expect(current(app)).toHaveAttribute('data-route', 'album');
  await expect(app.page.getByTestId('coll-title')).toBeVisible(); // kept alive: no skeleton, no refetch
  await app.page.getByTestId('nav-back').click();
  await expect(current(app)).not.toHaveAttribute('data-route', 'album');
  await app.shot('m1-3d-back-back');
});

test('app E-10: artist shelves scroll with the buttons; a vertical wheel over a shelf scrolls the page', async ({ app }) => {
  await nav(app, 'artist', { id: ARTIST });
  await expect(current(app).getByTestId('shelf').first().getByTestId('card').first()).toBeVisible({ timeout: 30_000 });
  // live data: a shelf with few cards does not overflow (the buttons then have nothing to scroll), so take the first one that does
  const shelves = current(app).getByTestId('shelf');
  const n = await shelves.count();
  let shelf = shelves.first();
  let found = false;
  for (let i = 0; i < n && !found; i++) {
    shelf = shelves.nth(i);
    found = await shelf.evaluate((e) => e.scrollWidth > e.clientWidth + 8);
  }
  test.skip(!found, 'no overflowing shelf on this live artist page');
  await shelf.scrollIntoViewIfNeeded();
  const section = shelf.locator('xpath=ancestor::section[1]'); // artist shelves are shelf-<key> sections, not shelf-section
  const sl = () => shelf.evaluate((e) => e.scrollLeft);
  const before = await sl();
  await section.getByTestId('shelf-right').click();
  await expect.poll(sl).toBeGreaterThan(before);
  let prev = -1;
  await expect.poll(async () => { const v = await sl(); const same = v === prev; prev = v; return same; }, { intervals: [200] }).toBe(true); // smooth scroll ended
  const b = (await shelf.boundingBox())!;
  await app.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const pageEl = () => app.page.evaluate(() => { const e = document.querySelector('.pg:not(.hid)') as HTMLElement; return [e.scrollTop, e.scrollHeight - e.clientHeight - e.scrollTop]; });
  const [top0, room] = await pageEl();
  const x0 = await sl(); // the smooth scroll was still settling in the app: allow sub-pixel drift below
  await app.page.mouse.wheel(0, room >= 300 ? 300 : -300); // the shelf can sit at the very end of the page: wheel towards the side with room
  await expect.poll(async () => (await pageEl())[0]).not.toBe(top0);
  expect(Math.abs((await sl()) - x0)).toBeLessThan(2); // a vertical wheel never becomes horizontal scroll
});

test('app: live playlist pages through the cursor (100+ rows are virtualised)', async ({ app }) => {
  await nav(app, 'playlist', { id: PLAYLIST });
  await expect(current(app).getByTestId('song-row').first()).toBeVisible({ timeout: 30_000 });
  await app.page.evaluate(() => (document.querySelector('.pg:not(.hid)') as HTMLElement).scrollTo(0, 1e6));
  await expect.poll(() => current(app).getByTestId('songs-list').evaluate((e) => parseInt((e as HTMLElement).style.height))).toBeGreaterThan(60 * 56);
  await app.shot('m1-3d-playlist-live');
});
