import { test, expect, type Page, type Locator } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

// M1-3c: Library (all filters), Liked / Downloads, UserAlbum, History, Stats, SongInfo.
// Web project (Vite + mock-core, 5,000 songs). Run with MM_WEB_PORT=5183 MOCK_PORT=48003.
// E-2 (End -> row 4,999, scroll kept after Album -> Back), E-8 (Library table row -> album), E-9 (F2, Del, drag reorder, persists after reload).
const base = process.env.MM_WEB_URL ?? (process.env.MM_WEB_PORT ? `http://127.0.0.1:${process.env.MM_WEB_PORT}` : undefined);
if (base) test.use({ baseURL: base });

const SHOTS = process.env.MM_SHOTS_DIR ?? path.resolve(__dirname, '../../../../shots-M1-3c');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

// the mock core keeps its state for the whole run (and a reused server across runs): album names are unique per run
const STAMP = Date.now().toString(36).slice(-4);
const VIEWPORTS = [
  { name: '1536x960@2.5', width: 1536, height: 960, dpr: 2.5, cls: 'expanded' },
  { name: '1920x1200@1', width: 1920, height: 1200, dpr: 1, cls: 'expanded' },
  { name: '1024x768', width: 1024, height: 768, dpr: 1, cls: 'medium' },
  { name: '800x600', width: 800, height: 600, dpr: 1, cls: 'compact' },
];

async function boot(page: Page, mock = '') {
  await page.emulateMedia({ colorScheme: 'dark' });
  if (mock) await page.addInitScript(mock);
  await page.goto('/?lang=en');
  await expect(page.getByTestId('app')).toBeVisible();
}
const calls = (page: Page, m?: string) =>
  page.evaluate((method) => ((window as any).__mmCalls as { m: string; p: any }[]).filter((c) => !method || c.m === method), m);
const clearCalls = (page: Page) => page.evaluate(() => ((window as any).__mmCalls.length = 0));

/** Opens a sidebar/rail destination. Medium and compact have no rail entry for History and Stats: use the overlay sidebar (Ctrl B). */
async function goNav(page: Page, key: string) {
  const el = page.getByTestId(`nav-${key}`);
  if (!(await el.isVisible())) {
    await page.keyboard.press('Control+b');
    await expect(el).toBeVisible();
  }
  await el.click();
  await expect(page.locator(`[data-route="${key === 'history' ? 'history' : key}"]`).first()).toBeVisible();
  // the overlay sidebar closes by itself on navigation; make sure it is gone before pointing at the page
  await page.waitForTimeout(350);
}
async function openLibrary(page: Page) {
  await goNav(page, 'library');
  await expect(page.getByTestId('songs-list')).toBeVisible();
  await expect(rowsOf(page, 'songs-table').first()).toBeVisible();
}
/** a click spot inside the row's title area: the centre of a narrow row falls on the album link */
const POS = { position: { x: 80, y: 28 } } as const;
const rowsOf = (page: Page, tid: string) => page.getByTestId(tid).getByTestId('song-row');
/** Opens the album of the first of `rows` that has one, through its context menu ("Go to album"); the Album column is hidden below 720 px, so there is no link there. */
async function goAlbumOf(page: Page, rows: Locator): Promise<number> {
  const n = Math.min(await rows.count(), 8);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    if (!(await row.locator('.tt .n').count())) continue; // still a skeleton
    await row.click({ button: 'right', ...POS });
    const item = page.locator('[data-id="go-album"]');
    if (await item.count()) {
      // the click above may have scrolled the row into view: the offset to keep is the one at this moment
      const top = await pgOf(page, 'library').evaluate((e) => e.scrollTop);
      await item.click();
      await expect(page.getByTestId('album')).toBeVisible();
      return top;
    }
    await page.keyboard.press('Escape');
  }
  throw new Error('no row with an album');
}
const titles = (t: Locator) => t.locator('.tt .n').allTextContents();
const pgOf = (page: Page, route: string) => page.locator(`[data-route="${route}"]`);

/** A fresh user album with `n` songs: Library > "Create album" > name, then Add to my album from the row menu. Returns after the page of the album is open. */
async function makeAlbum(page: Page, name: string, n: number) {
  await openLibrary(page);
  await page.getByTestId('lib-create-album').click();
  await page.getByTestId('prompt-input').fill(name);
  await page.getByTestId('prompt-ok').click();
  await expect(page.getByTestId('toast')).toContainText(name);
  await showAllAlbums(page);
  await expect(page.getByTestId('lib-albums').getByTestId('card').filter({ hasText: name })).toHaveCount(1, { timeout: 5000 });
  const rows = rowsOf(page, 'songs-table');
  await rows.nth(0).click(POS);
  await rows.nth(n - 1).click({ modifiers: ['Shift'], ...POS });
  await rows.nth(1).click({ button: 'right', ...POS });
  await page.locator('[data-id="add-album"]').hover();
  // the submenu lists every album and is taller than a 600 px window (M1-3a menu does not scroll): dispatch the click instead of pointing
  await page.locator('.mn[data-level="1"] [data-testid="menu-item"]').filter({ hasText: name }).dispatchEvent('click');
  await expect(page.getByTestId('toast')).toContainText(`Added ${n}`);
  await openUserAlbum(page, name);
}
async function showAllAlbums(page: Page) {
  const all = page.getByTestId('lib-albums-all');
  await expect(all).toBeVisible({ timeout: 5000 });
  if ((await all.textContent())?.startsWith('See all')) await all.click();
}
async function openUserAlbum(page: Page, name: string) {
  await openLibrary(page);
  await showAllAlbums(page);
  await page.getByTestId('lib-albums').getByTestId('card').filter({ hasText: name }).click();
  await expect(page.getByTestId('user-album')).toBeVisible();
  await expect(page.getByTestId('ua-title')).toHaveText(name);
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr });

    test('E-2 Library: End selects and shows row 4,999; scroll kept after Album -> Back', async ({ page }) => {
      await boot(page);
      await openLibrary(page);
      if (vp.name === '1536x960@2.5' || vp.name === '800x600') await shot(page, `library-${vp.name}`);
      await rowsOf(page, 'songs-table').first().click(POS);
      await page.keyboard.press('End');
      const last = page.locator('[data-testid="songs-table"] [data-testid="song-row"][data-index="4999"]');
      await expect(last).toBeVisible({ timeout: 8000 });
      await expect(last).toHaveAttribute('aria-selected', 'true');
      expect((await last.locator('.tt .n').textContent())?.length).toBeGreaterThan(0);
      await expect(last.locator('.ix .n')).toHaveText('5000');
      const top = await pgOf(page, 'library').evaluate((e) => e.scrollTop);
      expect(top).toBeGreaterThan(200_000);
      // a visible row's album link opens the album; Alt Left comes back to the same scroll offset
      const kept = await goAlbumOf(page, rowsOf(page, 'songs-table'));
      await page.keyboard.press('Alt+ArrowLeft');
      await expect(page.getByTestId('library')).toBeVisible();
      await expect.poll(async () => Math.abs((await pgOf(page, 'library').evaluate((e) => e.scrollTop)) - kept), { timeout: 5000 }).toBeLessThan(4);
      expect(kept).toBeGreaterThan(200_000);
    });

    test('Library chips switch the lists; the text filter is debounced; sorting by header', async ({ page }) => {
      await boot(page);
      await openLibrary(page);
      await expect(page.getByTestId('lib-chip-songs')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('lib-count')).toHaveText('5000 songs');

      // sort by header click: title ascending, then descending
      await clearCalls(page);
      await page.getByTestId('th-title').click();
      await expect(page.getByTestId('th-title')).toHaveAttribute('aria-sort', 'ascending');
      await expect.poll(async () => (await calls(page, 'library.window')).some((c) => c.p.sort.by === 'title' && !c.p.sort.desc)).toBe(true);
      await page.getByTestId('th-title').click();
      await expect(page.getByTestId('th-title')).toHaveAttribute('aria-sort', 'descending');

      // text filter: 3 keystrokes inside the debounce window -> one library.window with the whole text
      await expect(rowsOf(page, 'songs-table').first().locator('.tt .n')).toBeVisible();
      const first = (await titles(page.getByTestId('songs-table')))[0].trim();
      const word = first.split(/\s+/)[0];
      await clearCalls(page);
      await page.getByTestId('lib-filter').pressSequentially(word, { delay: 15 });
      await expect.poll(async () => (await calls(page, 'library.window')).filter((c) => c.p.filter?.text).length).toBeGreaterThan(0);
      const filtered = (await calls(page, 'library.window')).filter((c) => c.p.filter?.text);
      expect(filtered.every((c) => c.p.filter.text === word)).toBe(true);
      expect(filtered.length, 'one filtered fetch per chunk, not one per keystroke').toBeLessThanOrEqual(3);
      await expect(page.getByTestId('lib-count')).not.toHaveText('5000 songs');
      await page.getByTestId('lib-filter').fill('');
      await expect(page.getByTestId('lib-count')).toHaveText('5000 songs', { timeout: 5000 });

      // Liked, Downloaded: song tables over their own lists
      await page.getByTestId('lib-chip-liked').click();
      await expect(page.getByTestId('liked-table')).toBeVisible();
      await expect(page.getByTestId('songs-table')).toHaveCount(0);
      await expect(rowsOf(page, 'liked-table').first()).toBeVisible();
      await expect(page.getByTestId('lib-albums')).toHaveCount(0);
      await page.getByTestId('lib-chip-downloaded').click();
      await expect(page.getByTestId('downloads-table')).toBeVisible();
      await expect(rowsOf(page, 'downloads-table').first()).toBeVisible();

      // Albums, Artists, Playlists: virtualised card grids (and a list view)
      for (const f of ['albums', 'artists', 'playlists']) {
        await page.getByTestId(`lib-chip-${f}`).click();
        await expect(page.getByTestId('lib-cards')).toBeVisible();
        await expect(page.getByTestId('lib-cards').getByTestId('card').first()).toBeVisible();
        await expect(page.getByTestId('lib-cards').getByTestId('song-row')).toHaveCount(0);
      }
      await page.getByTestId('lib-chip-albums').click();
      const cards = page.getByTestId('lib-cards').getByTestId('card');
      await expect(cards.first()).toBeVisible();
      const xs = await cards.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
      const cw = vp.cls === 'expanded' ? 184 : vp.cls === 'medium' ? 160 : 144;
      const avail = await page.getByTestId('lib-cards').evaluate((e) => e.clientWidth);
      expect(xs).toBe(Math.max(1, Math.floor((avail + (vp.cls === 'compact' ? 16 : 24)) / (cw + (vp.cls === 'compact' ? 16 : 24)))));
      await page.getByTestId('lib-view-list').click();
      await expect(page.getByTestId('lib-lrow').first()).toBeVisible();
      await expect(page.getByTestId('lib-cards')).toHaveAttribute('data-view', 'list');
      await page.getByTestId('lib-view-grid').click();
      await expect(cards.first()).toBeVisible();
      if (vp.name === '1536x960@2.5') await shot(page, 'library-albums-grid');
      await page.getByTestId('lib-chip-songs').click();
      await expect(page.getByTestId('songs-table')).toBeVisible();
      await expect(page.getByTestId('lib-albums')).toBeVisible();
    });

    test('E-8 a Library row opens its album; "Tạo album mới" tile and the shelf', async ({ page }) => {
      await boot(page);
      await openLibrary(page);
      await clearCalls(page);
      await goAlbumOf(page, rowsOf(page, 'songs-table'));
      await page.keyboard.press('Alt+ArrowLeft');
      await expect(page.getByTestId('library')).toBeVisible();
      // dashed tile + at least 3 seeded albums; the tile is first
      const tiles = page.getByTestId('lib-albums').getByTestId('card');
      await expect(tiles.first().locator('.dash')).toBeVisible();
      expect(await tiles.count()).toBeGreaterThanOrEqual(4);
      // play on a card plays the user album context
      await tiles.nth(1).hover();
      await tiles.nth(1).locator('.cfab').click();
      await expect.poll(async () => (await calls(page, 'player.play')).length).toBeGreaterThan(0);
      expect((await calls(page, 'player.play'))[0].p.context).toMatchObject({ kind: 'userAlbum' });
      // Enter plays the selection in the table: library context, startId
      await rowsOf(page, 'songs-table').nth(3).click(POS);
      await clearCalls(page);
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await calls(page, 'player.play')).length).toBe(1);
      const p = (await calls(page, 'player.play'))[0].p;
      expect(p.context).toMatchObject({ kind: 'library', list: 'songs', sort: { by: 'added', desc: true } });
      expect(typeof p.startId).toBe('string');
    });

    test('E-9 user album: F2 rename, Del remove, drag reorder, persists after reload', async ({ page }) => {
      await boot(page);
      const name = `E9 ${vp.name} ${STAMP}`;
      await makeAlbum(page, name, 4);
      const tbl = page.getByTestId('ua-table');
      await expect(tbl.getByTestId('song-row')).toHaveCount(4);
      await expect(page.getByTestId('ua-sub')).toContainText('4 songs');
      if (vp.name === '1920x1200@1' || vp.name === '800x600') await shot(page, `useralbum-${vp.name}`);
      const before = await titles(tbl);

      // drag reorder: row 0 below row 2 (the line is drawn, userAlbum.move {from:0,to:2} is sent with a revision)
      const rows = tbl.getByTestId('song-row');
      const a = (await rows.nth(0).boundingBox())!;
      const c = (await rows.nth(2).boundingBox())!;
      await clearCalls(page);
      await page.mouse.move(a.x + 120, a.y + 28);
      await page.mouse.down();
      await page.mouse.move(a.x + 120, a.y + 70, { steps: 4 });
      await page.mouse.move(a.x + 120, c.y + 50, { steps: 6 });
      await expect(page.getByTestId('ua-drop-line')).toHaveClass(/on/);
      await page.mouse.up();
      await expect.poll(async () => (await calls(page, 'userAlbum.move')).length).toBe(1);
      const mv = (await calls(page, 'userAlbum.move'))[0].p;
      expect(mv).toMatchObject({ from: 0, to: 2 });
      expect(typeof mv.expectedRevision).toBe('number');
      await expect.poll(() => titles(tbl)).toEqual([before[1], before[2], before[0], before[3]]);

      // F2 renames
      await page.keyboard.press('F2');
      await expect(page.getByTestId('prompt-dialog')).toBeVisible();
      await page.getByTestId('prompt-input').fill(`${name} renamed`);
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('ua-title')).toHaveText(`${name} renamed`);
      expect((await calls(page, 'userAlbum.rename')).length).toBe(1);

      // Del removes the selected row (setVideoId = entry id)
      await clearCalls(page);
      await rows.nth(3).click(POS);
      await page.keyboard.press('Delete');
      await expect.poll(async () => (await calls(page, 'userAlbum.remove')).length).toBe(1);
      const rm = (await calls(page, 'userAlbum.remove'))[0].p;
      expect(rm.entryIds).toHaveLength(1);
      await expect(rows).toHaveCount(3);
      const after = await titles(tbl);
      expect(after).toEqual([before[1], before[2], before[0]]);

      // persists after a reload
      await page.reload();
      await expect(page.getByTestId('app')).toBeVisible();
      await openUserAlbum(page, `${name} renamed`);
      await expect(page.getByTestId('ua-table').getByTestId('song-row')).toHaveCount(3);
      expect(await titles(page.getByTestId('ua-table'))).toEqual(after);
    });

    test('user album header: play/shuffle contexts, pin toggle, delete with confirmation, Del without selection does nothing', async ({ page }) => {
      await boot(page);
      const name = `UA ${vp.name} ${STAMP}`;
      await makeAlbum(page, name, 3);
      await clearCalls(page);
      await page.getByTestId('ua-play').click();
      await page.getByTestId('ua-shuffle').click();
      const plays = await calls(page, 'player.play');
      expect(plays[0].p).toMatchObject({ context: { kind: 'userAlbum', title: name } });
      expect(plays[1].p.shuffle).toBe(true);
      await page.getByTestId('ua-pin').click();
      await expect.poll(async () => (await calls(page, 'userAlbum.pin')).length).toBe(1);
      expect((await calls(page, 'userAlbum.pin'))[0].p.pinned).toBe(true);
      await page.keyboard.press('Delete');
      expect((await calls(page, 'userAlbum.remove')).length).toBe(0);
      // double click plays from that row
      await clearCalls(page);
      await page.getByTestId('ua-table').getByTestId('song-row').nth(1).dblclick(POS);
      await expect.poll(async () => (await calls(page, 'player.play')).length).toBe(1);
      expect((await calls(page, 'player.play'))[0].p).toMatchObject({ context: { kind: 'userAlbum' } });
      expect(typeof (await calls(page, 'player.play'))[0].p.startId).toBe('string');
      // delete asks first, then leaves the page
      await page.getByTestId('ua-delete').click();
      await expect(page.getByTestId('confirm-dialog')).toBeVisible();
      await page.getByTestId('confirm-ok').click();
      await expect(page.getByTestId('library')).toBeVisible();
      expect((await calls(page, 'userAlbum.delete')).length).toBe(1);
    });

    test('user album: the header collapses into the sticky 56 bar (sentinel, no scroll handler)', async ({ page }) => {
      await boot(page);
      await openLibrary(page);
      const tiles = page.getByTestId('lib-albums').getByTestId('card');
      // a seeded album has 20+ songs, enough to scroll at every viewport
      await tiles.nth(1).click();
      await expect(page.getByTestId('user-album')).toBeVisible();
      await expect(page.getByTestId('ua-sticky')).not.toHaveClass(/on/);
      const art = await page.locator('[data-testid="user-album"] .ua-art').first().boundingBox();
      expect(art!.width).toBeCloseTo(vp.height < 760 ? 168 : 232, 0);
      await expect(page.getByTestId('ua-table').getByTestId('song-row').first()).toBeVisible();
      await pgOf(page, 'userAlbum').evaluate((e) => (e.scrollTop = 600));
      await expect(page.getByTestId('ua-sticky')).toHaveClass(/on/);
      expect((await page.getByTestId('ua-sticky').boundingBox())!.height).toBe(56);
      await pgOf(page, 'userAlbum').evaluate((e) => (e.scrollTop = 0));
      await expect(page.getByTestId('ua-sticky')).not.toHaveClass(/on/);
      await expect(page.locator('[data-testid="ua-table"] .tr.playing')).toHaveCount(0);
    });

    test('Liked and Downloads pages: count, Play all, Shuffle', async ({ page }) => {
      await boot(page);
      await goNav(page, 'liked');
      await expect(page.getByTestId('liked-table')).toBeVisible();
      await expect(rowsOf(page, 'liked-table').first()).toBeVisible();
      await expect(page.getByTestId('liked').getByTestId('lib-count')).toContainText('songs');
      await clearCalls(page);
      await page.getByTestId('liked').getByTestId('lib-play-all').click();
      await page.getByTestId('liked').getByTestId('lib-shuffle').click();
      const pl = await calls(page, 'player.play');
      expect(pl[0].p.context).toMatchObject({ kind: 'library', list: 'liked' });
      expect(pl[1].p.shuffle).toBe(true);
      await goNav(page, 'downloads');
      await expect(page.getByTestId('downloads-table')).toBeVisible();
      await expect(rowsOf(page, 'downloads-table').first()).toBeVisible();
      await expect(page.getByTestId('dl-box')).toHaveCount(0); // download.summary is not answered by the mock core
    });

    test('History: group headers, windowed list, Del removes the selection', async ({ page }) => {
      await boot(page);
      await goNav(page, 'history');
      const list = page.getByTestId('hist-list');
      await expect(page.getByTestId('hist-group').first()).toBeVisible();
      await expect(page.getByTestId('hist-group').first()).toHaveText('Today');
      await expect(rowsOf(page, 'hist-table').first()).toBeVisible();
      // heights: header 32, track 56, header followed by its first row
      const h = await page.locator('.hs-item').evaluateAll((els) => els.map((e) => ({ h: Math.round(e.getBoundingClientRect().height), head: !!e.querySelector('.hs-head'), top: Math.round(e.getBoundingClientRect().top) })));
      expect(h.filter((x) => x.head).every((x) => x.h === 32)).toBe(true);
      expect(h.filter((x) => !x.head).every((x) => x.h === 56)).toBe(true);
      const total = Number((await page.getByTestId('hist-count').textContent())!.split(' ')[0]);
      expect(total).toBeGreaterThan(500);
      expect(h.length, 'only a window of rows is in the DOM').toBeLessThan(120);
      expect(Number(await list.evaluate((e) => parseFloat((e as HTMLElement).style.height)))).toBeGreaterThan(total * 56);
      if (vp.name === '1920x1200@1' || vp.name === '800x600') await shot(page, `history-${vp.name}`);
      // End -> the last row (older group) is rendered with its header further up
      await rowsOf(page, 'hist-table').first().click(POS);
      await page.keyboard.press('End');
      await expect(page.locator(`[data-testid="hist-table"] [data-testid="song-row"][data-index="${total - 1}"]`)).toBeVisible({ timeout: 8000 });
      expect(await page.locator('.hs-item').count(), 'still a window of rows after the jump').toBeLessThan(120);
      await page.keyboard.press('Home');
      await expect(page.locator('[data-testid="hist-table"] [data-testid="song-row"][data-index="0"]')).toBeVisible();
      // Del removes the selected rows with history.remove {eventIds}
      await clearCalls(page);
      await rowsOf(page, 'hist-table').nth(0).click(POS);
      await rowsOf(page, 'hist-table').nth(1).click({ modifiers: ['Shift'], ...POS });
      await page.keyboard.press('Delete');
      await expect.poll(async () => (await calls(page, 'history.remove')).length).toBe(1);
      expect((await calls(page, 'history.remove'))[0].p.eventIds).toHaveLength(2);
      await expect(page.getByTestId('hist-count')).toHaveText(`${total - 2} songs`, { timeout: 5000 });
      // double click plays from that row
      await clearCalls(page);
      await rowsOf(page, 'hist-table').nth(2).dblclick(POS);
      await expect.poll(async () => (await calls(page, 'player.play')).length).toBe(1);
      expect((await calls(page, 'player.play'))[0].p).toMatchObject({ context: { kind: 'library', list: 'history' }, startIndex: 2 });
    });

    test('Stats: period segment loads stats.get, minutes tile, top 10, artist and album rows', async ({ page }) => {
      await boot(page);
      await goNav(page, 'stats');
      await expect(page.getByTestId('stats-minutes-n')).not.toHaveText('0');
      await expect(page.getByTestId('stats-tracks').getByTestId('song-row')).toHaveCount(10);
      await expect(page.getByTestId('stats-artists').getByTestId('card').first()).toBeVisible();
      await expect(page.getByTestId('stats-albums').getByTestId('card').first()).toBeVisible();
      expect((await calls(page, 'stats.get'))[0].p).toEqual({ period: 'week' });
      const week = Number(await page.getByTestId('stats-minutes-n').textContent());
      await clearCalls(page);
      await page.getByRole('tab', { name: 'Month' }).click();
      await expect.poll(async () => (await calls(page, 'stats.get')).length).toBe(1);
      expect((await calls(page, 'stats.get'))[0].p).toEqual({ period: 'month' });
      await expect.poll(async () => Number(await page.getByTestId('stats-minutes-n').textContent())).toBeGreaterThanOrEqual(week);
      const bar = await page.getByTestId('stats-bar').evaluate((e) => getComputedStyle(e).transform);
      expect(bar).toMatch(/^matrix/);
      await page.getByRole('tab', { name: 'All time' }).click();
      await expect(page.getByTestId('stats-bar')).toHaveCount(0);
      if (vp.name === '1536x960@2.5' || vp.name === '800x600') await shot(page, `stats-${vp.name}`);
    });

    test('Ctrl I opens SongInfo for the selected row; the context menu entry too; Esc closes', async ({ page }) => {
      await boot(page);
      await openLibrary(page);
      const row = rowsOf(page, 'songs-table').nth(2);
      const title = (await row.locator('.tt .n').textContent())!;
      await row.click(POS);
      await clearCalls(page);
      await page.keyboard.press('Control+i');
      await expect(page.getByTestId('songinfo-dialog')).toBeVisible();
      await expect(page.getByTestId('si-title')).toHaveText(title);
      expect((await calls(page, 'track.info'))[0].p.id).toBeTruthy();
      await expect(page.getByTestId('si-codec')).not.toHaveText('—');
      if (vp.name === '1920x1200@1') await shot(page, 'songinfo');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('songinfo-dialog')).toHaveCount(0);
      // via the menu
      await row.click({ button: 'right', ...POS });
      await page.locator('[data-id="info"]').click();
      await expect(page.getByTestId('songinfo-dialog')).toBeVisible();
      await expect(page.getByTestId('si-title')).toHaveText(title);
      await page.getByTestId('songinfo-close').click();
      await expect(page.getByTestId('songinfo-dialog')).toHaveCount(0);
    });
  });
}

test.describe('downloads summary box (core answers download.summary)', () => {
  test.use({ viewport: { width: 1536, height: 960 }, deviceScaleFactor: 2.5 });
  test('shown in the Library with quality badges; hidden when the core says unsupported', async ({ page }) => {
    await boot(
      page,
      `window.__mmMock = { 'download.summary': () => ({ count: 1248, bytes: 6200000000, byQuality: [{label:'FLAC',count:214},{label:'320',count:806},{label:'Opus 160',count:228}], folder: 'D:\\\\Nhac\\\\MinMusic', folderOk: true, active: {done:3,total:12,label:'Chill cuoi tuan'}, paused: false }) };`
    );
    await openLibrary(page);
    const box = page.getByTestId('dl-box');
    await expect(box).toBeVisible();
    await expect(box).toContainText('1.248');
    await expect(box).toContainText('6,2 GB');
    await expect(box).toContainText('FLAC');
    await expect(box).toContainText('Downloading 3/12');
    await shot(page, 'library-dlbox');
    const fill = await box.locator('.bar-fill').evaluate((e) => getComputedStyle(e).transform);
    expect(fill).toMatch(/matrix\(0\.25/);
  });
  test('unsupported: no box', async ({ page }) => {
    await boot(
      page,
      `window.__mmMock = { 'download.summary': () => { throw Object.assign(new Error('unsupported'), { code: 'unsupported' }); } };`
    );
    await openLibrary(page);
    await page.waitForTimeout(400);
    await expect(page.getByTestId('dl-box')).toHaveCount(0);
  });
});

test.describe('conflict on reorder', () => {
  test.use({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
  test('userAlbum.move conflict refetches and toasts', async ({ page }) => {
    await boot(page);
    const name = `Conflict ${STAMP}`;
    await makeAlbum(page, name, 3);
    await page.evaluate(() => {
      (window as any).__mmMock = { 'userAlbum.move': () => { throw Object.assign(new Error('stale'), { code: 'conflict' }); } };
    });
    const rows = page.getByTestId('ua-table').getByTestId('song-row');
    const a = (await rows.nth(0).boundingBox())!;
    const c = (await rows.nth(2).boundingBox())!;
    await clearCalls(page);
    await page.mouse.move(a.x + 120, a.y + 28);
    await page.mouse.down();
    await page.mouse.move(a.x + 120, a.y + 70, { steps: 4 });
    await page.mouse.move(a.x + 120, c.y + 50, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId('toast')).toHaveText('The album changed elsewhere. Reloaded.');
    expect((await calls(page, 'library.window')).length).toBeGreaterThan(0);
  });
});

test.describe('perf proxy', () => {
  test.use({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
  test('40 wheel steps over the 5,000-row Library table: 0 long tasks, no slow frames', async ({ page }) => {
    await boot(page);
    await openLibrary(page);
    await page.addScriptTag({
      content: `window.__long = []; window.__frames = []; window.__mon = true;
        new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ entryTypes: ['longtask'] });
        let last = performance.now();
        const loop = (t) => { window.__frames.push(t - last); last = t; if (window.__mon) requestAnimationFrame(loop); };
        requestAnimationFrame(loop);`,
    });
    const cdp = await page.context().newCDPSession(page);
    const events: any[] = [];
    cdp.on('Tracing.dataCollected', (d: any) => events.push(...d.value));
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
    const b = (await page.getByTestId('songs-list').boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, Math.min(b.y + 300, 500));
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(300);
    const done = new Promise<void>((r) => cdp.once('Tracing.tracingComplete', () => r()));
    await cdp.send('Tracing.end');
    await done;
    const res = await page.evaluate(() => { (window as any).__mon = false; return { long: (window as any).__long as number[], frames: ((window as any).__frames as number[]).slice(2) }; });
    const tasks = events.filter((e) => e.name === 'RunTask' && e.ph === 'X' && e.dur > 50_000);
    const sorted = [...res.frames].sort((x, y) => x - y);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const slow = res.frames.filter((f) => f > 16.7 * 1.5).length;
    const over16 = events.filter((e) => e.name === 'RunTask' && e.ph === 'X' && e.dur > 16_700).length;
    console.log(`perf: 40 wheel steps, ${res.frames.length} frames, long tasks (observer) ${res.long.length}, RunTask > 50 ms ${tasks.length}, frame p95 ${p95.toFixed(1)} ms, worst ${sorted[sorted.length - 1]?.toFixed(1)} ms, frames > 25 ms: ${slow}, RunTask > 16.7 ms ${over16}`);
    expect(res.long.length, 'long tasks (> 50 ms), PerformanceObserver').toBe(0);
    expect(tasks.length, 'RunTask > 50 ms in the CDP trace').toBe(0);
    expect(slow, 'frames over 25 ms (headless software rendering: allow 5 %)').toBeLessThanOrEqual(Math.ceil(res.frames.length * 0.05));
    expect(await pgOf(page, 'library').evaluate((e) => e.scrollTop), 'the wheel scrolled the page').toBeGreaterThan(0);
  });
});

test.describe('history clear', () => {
  test.use({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
  // last on purpose: it empties the mock history
  test('"Clear history" asks first, then history.clear leaves an empty state', async ({ page }) => {
    await boot(page);
    await goNav(page, 'history');
    await expect(rowsOf(page, 'hist-table').first()).toBeVisible();
    await page.getByTestId('hist-clear').click();
    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    expect((await calls(page, 'history.clear')).length).toBe(0);
    await page.getByTestId('hist-clear').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('hist-empty')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('hist-count')).toHaveText('0 songs');
    await shot(page, 'history-empty');
  });
});
