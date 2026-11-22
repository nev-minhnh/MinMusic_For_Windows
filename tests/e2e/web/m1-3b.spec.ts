import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

// M1-3b: Home (final), Search, Charts, Browse. Web project (Vite + mock-core). Run with MM_WEB_PORT=5182 MOCK_PORT=48002.
// E-1 Home from cache + quick-pick columns, E-6 Ctrl K / suggestions / Enter / chips / Esc in 3 steps, chart play with the whole list,
// shelf buttons and the vertical wheel (E-10 for Home shelves), Charts page, Browse + moods, long-task proxy.
const base = process.env.MM_WEB_URL ?? (process.env.MM_WEB_PORT ? `http://127.0.0.1:${process.env.MM_WEB_PORT}` : undefined);
if (base) test.use({ baseURL: base });

const SHOTS = process.env.MM_SHOTS_DIR ?? path.resolve(__dirname, '../../../../shots-M1-3b');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

const VIEWPORTS = [
  { name: '1536x960@2.5', width: 1536, height: 960, dpr: 2.5, cols: 4 },
  { name: '1920x1200@1', width: 1920, height: 1200, dpr: 1, cols: 5 },
  { name: '1024x768', width: 1024, height: 768, dpr: 1, cols: 3 },
  { name: '800x600', width: 800, height: 600, dpr: 1, cols: 2 },
];

async function boot(page: Page, hash = '', init?: string) {
  await page.emulateMedia({ colorScheme: 'dark' });
  if (init) await page.addInitScript(init);
  await page.goto(`/?lang=vi${hash}`);
  await expect(page.getByTestId('app')).toBeVisible();
}
const calls = (page: Page, m: string) => page.evaluate((method) => ((window as any).__mmCalls as { m: string; p: any }[]).filter((c) => c.m === method), m);
const clearCalls = (page: Page) => page.evaluate(() => ((window as any).__mmCalls.length = 0));
const pgScroll = (page: Page) => page.evaluate(() => (document.querySelector('.pg:not(.hid)') as HTMLElement).scrollTop);
const colsOf = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="quick-picks"]')!).gridTemplateColumns.split(' ').length);

for (const vp of VIEWPORTS) {
  test.describe(`Home ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr });

    test('E-1 quick picks columns, charts box, shelves; cached Home paints before home.get answers', async ({ page }) => {
      await boot(page);
      await expect(page.getByTestId('qp-tile').first()).toBeVisible();
      await expect(page.getByTestId('chart-row')).toHaveCount(10);
      expect(await colsOf(page)).toBe(vp.cols);
      await expect(page.getByTestId('shelf-section').first()).toBeVisible();
      await page.waitForTimeout(400); // the live result was written to IndexedDB (mm.home.v1)
      await shot(page, `home-${vp.name}`);

      // reload with a home.get that never answers: the IndexedDB copy alone paints the page
      await page.addInitScript(`window.__mmMock = { 'home.get': () => new Promise(() => {}) };`);
      await page.reload();
      await expect(page.getByTestId('app')).toBeVisible();
      await expect(page.getByTestId('qp-tile').first()).toBeVisible({ timeout: 3000 });
      expect(await page.getByTestId('qp-tile').count()).toBeGreaterThanOrEqual(vp.cols * 2 - 1);
    });
  });
}

test.describe('Home behaviour 1536x960', () => {
  test.use({ viewport: { width: 1536, height: 960 }, deviceScaleFactor: 2.5 });

  test('quick pick double-click plays the whole list with startIndex', async ({ page }) => {
    await boot(page);
    const tiles = page.getByTestId('qp-tile');
    await expect(tiles.first()).toBeVisible();
    await clearCalls(page);
    await tiles.nth(2).dblclick();
    await expect.poll(async () => (await calls(page, 'player.play')).length).toBe(1);
    const p = (await calls(page, 'player.play'))[0].p;
    expect(p.context.kind).toBe('tracks');
    expect(p.context.ids.length).toBeGreaterThanOrEqual(8);
    expect(p.startIndex).toBe(2);
  });

  test('chart row double-click sends the full chart list (>= 10 ids), source switch calls charts.get', async ({ page }) => {
    await boot(page);
    const rows = page.getByTestId('chart-row');
    await expect(rows.first()).toBeVisible();
    await clearCalls(page);
    await rows.nth(3).dblclick();
    await expect.poll(async () => (await calls(page, 'player.play')).length).toBe(1);
    const p = (await calls(page, 'player.play'))[0].p;
    expect(p.context.kind).toBe('tracks');
    expect(p.context.ids.length).toBeGreaterThanOrEqual(10);
    expect(p.startIndex).toBe(3);
    await clearCalls(page);
    await page.getByRole('tab', { name: 'NhacCuaTui' }).click();
    await expect.poll(async () => (await calls(page, 'charts.get')).length).toBe(1);
    expect((await calls(page, 'charts.get'))[0].p.source).toBe('nct');
    await expect(rows.first()).toBeVisible();
  });

  test('shelf buttons scroll by one visible width; the vertical wheel over a shelf scrolls the page (E-10)', async ({ page }) => {
    await boot(page);
    const shelf = page.getByTestId('shelf').first();
    await expect(shelf).toBeVisible();
    await shelf.scrollIntoViewIfNeeded();
    const info = await shelf.evaluate((el) => ({ w: el.clientWidth, sw: el.scrollWidth }));
    expect(info.sw).toBeGreaterThan(info.w);
    await page.getByTestId('shelf-next').first().click();
    await expect.poll(() => shelf.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    await page.getByTestId('shelf-prev').first().click();
    await expect.poll(() => shelf.evaluate((el) => el.scrollLeft)).toBeLessThan(5);
    // vertical wheel over the shelf: the page scrolls, the shelf does not move
    const b = (await shelf.boundingBox())!;
    const before = await pgScroll(page);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => pgScroll(page)).toBeGreaterThan(before + 100);
    expect(await shelf.evaluate((el) => el.scrollLeft)).toBe(0);
  });

  test('chips swap the shelves without a page transition; Tâm trạng opens the moods grid; home.more loads on scroll', async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId('shelf-section').first()).toBeVisible();
    const first = await page.getByTestId('shelf-section').first().getAttribute('data-shelf');
    await clearCalls(page);
    await page.getByTestId('home-chips').getByRole('button', { name: 'Thư giãn' }).click();
    // skeleton or data on screen at once, the route did not change
    await expect(page.getByTestId('home')).toBeVisible();
    await expect.poll(async () => (await calls(page, 'home.get')).some((c) => c.p.chip === 'relax')).toBe(true);
    await expect(page.getByTestId('shelf-section').first()).not.toHaveAttribute('data-shelf', first!);
    await page.getByTestId('home-chips').getByRole('button', { name: 'Thư giãn' }).click(); // deselect
    await expect(page.getByTestId('shelf-section').first()).toHaveAttribute('data-shelf', first!);
    // home.more: sentinel at the bottom
    await clearCalls(page);
    await page.getByTestId('home-sentinel').scrollIntoViewIfNeeded();
    await expect.poll(async () => (await calls(page, 'home.more')).length).toBeGreaterThanOrEqual(1);
    // moods
    await page.getByTestId('home-chips').getByRole('button', { name: 'Tâm trạng' }).click();
    await expect(page.getByTestId('moods-grid')).toBeVisible();
    await expect(page.getByTestId('mood-tile').first()).toBeVisible();
    await page.getByTestId('mood-tile').first().click();
    await expect(page.getByTestId('browse-title').last()).toHaveText('Thư giãn');
    await expect(page.getByTestId('browse-page').last().getByTestId('shelf-section').first()).toBeVisible();
  });

});

test.describe('Search 1280x800', () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

  test('E-6 Ctrl K focuses, <= 8 suggestions, Enter shows results, chips filter, Esc in 3 steps', async ({ page }) => {
    await boot(page);
    const input = page.getByTestId('search-input');
    await expect(page.getByTestId('qp-tile').first()).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(input).toBeFocused();
    // empty field: history rows with a remove button
    await expect(page.getByTestId('suggest-row').first()).toBeVisible();
    await expect(page.getByTestId('suggest-remove').first()).toBeVisible();
    await clearCalls(page);
    await input.pressSequentially('sơn');
    await expect.poll(async () => (await calls(page, 'search.suggest')).length).toBeGreaterThanOrEqual(1);
    expect((await calls(page, 'search.suggest')).length).toBeLessThanOrEqual(2); // debounced, not one per key
    await expect(page.getByTestId('suggest-row').first()).toBeVisible();
    const n = await page.getByTestId('suggest-row').count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(8);
    await shot(page, 'search-suggest-1280x800');
    await input.fill('sơn tùng');
    await input.press('Enter');
    await expect(page.getByTestId('search-page')).toBeVisible();
    await expect(page.getByTestId('search-top')).toBeVisible();
    await expect(page.getByTestId('songs-table').first()).toBeVisible();
    await expect(page.getByTestId('search-page').getByTestId('song-row').first()).toBeVisible();
    await shot(page, 'search-results-1280x800');
    // source chip filters: a new search.run with source=zing
    await clearCalls(page);
    await page.getByTestId('search-chips').getByRole('button', { name: 'Zing MP3' }).click();
    await expect.poll(async () => (await calls(page, 'search.run')).some((c) => c.p.source === 'zing')).toBe(true);
    await page.getByTestId('search-chips').getByRole('button', { name: 'Tất cả' }).click();
    // type chip: songs only
    await page.getByTestId('search-chips').getByRole('button', { name: 'Bài hát' }).click();
    await expect.poll(async () => (await calls(page, 'search.run')).some((c) => c.p.type === 'track')).toBe(true);
    await page.getByTestId('search-chips').getByRole('button', { name: 'Bài hát' }).click(); // the active type chip toggles back to all
    await expect(page.getByTestId('search-top')).toBeVisible();
    // Esc: 1 clears the field, 2 blurs it, 3 leaves the results
    await input.focus();
    await expect(input).toHaveValue('sơn tùng');
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(page.getByTestId('search-page')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(input).not.toBeFocused();
    await expect(page.getByTestId('search-page')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('search-page')).toBeHidden();
  });

  test('slash focuses the field; arrow keys + Enter pick a suggestion; history entry can be removed', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('/');
    await expect(page.getByTestId('search-input')).toBeFocused();
    const rows = page.getByTestId('suggest-row');
    await expect(rows.first()).toBeVisible();
    const h0 = await rows.count();
    await clearCalls(page);
    await page.getByTestId('suggest-remove').first().click();
    await expect.poll(async () => (await calls(page, 'search.history.remove')).length).toBe(1);
    await expect(rows).toHaveCount(h0 - 1);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('search-page')).toBeVisible();
  });

  test('Ctrl+F also focuses the field', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('Control+f');
    await expect(page.getByTestId('search-input')).toBeFocused();
  });

  test('double-click on a result song plays the section list with startIndex', async ({ page }) => {
    await boot(page);
    await page.getByTestId('search-input').fill('sơn');
    await page.getByTestId('search-input').press('Enter');
    const rows = page.getByTestId('search-page').getByTestId('song-row');
    await expect(rows.first()).toBeVisible();
    await clearCalls(page);
    await rows.nth(1).dblclick();
    await expect.poll(async () => (await calls(page, 'player.play')).length).toBe(1);
    const p = (await calls(page, 'player.play'))[0].p;
    expect(p.context.kind).toBe('tracks');
    expect(p.context.ids.length).toBeGreaterThan(1);
    expect(p.startIndex).toBe(1);
  });
});

test.describe('Charts and Browse', () => {
  test.use({ viewport: { width: 1536, height: 960 }, deviceScaleFactor: 2.5 });

  test('Xem tất cả opens Charts: 100 ranked rows, tabs, play all, row double-click', async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId('chart-row').first()).toBeVisible();
    await page.getByTestId('charts-all').click();
    await expect(page.getByTestId('charts-page')).toBeVisible();
    await expect(page.getByTestId('chart-count')).toContainText('100');
    await expect(page.getByTestId('chart-line').first()).toBeVisible();
    await expect(page.getByTestId('chart-trend').first()).toBeVisible();
    await shot(page, 'charts-1536x960');
    // tab switch
    await clearCalls(page);
    await page.getByRole('tab', { name: 'US-UK' }).click();
    await expect.poll(async () => (await calls(page, 'charts.get')).some((c) => c.p.key === 'us')).toBe(true);
    await expect(page.getByTestId('chart-line').first()).toBeVisible();
    await clearCalls(page);
    await page.getByTestId('chart-play-all').click();
    await expect.poll(async () => (await calls(page, 'player.play')).length).toBe(1);
    expect((await calls(page, 'player.play'))[0].p.context.ids.length).toBe(100);
    await clearCalls(page);
    await page.getByTestId('chart-line').nth(2).dblclick();
    await expect.poll(async () => (await calls(page, 'player.play')).length).toBe(1);
    const p = (await calls(page, 'player.play'))[0].p;
    expect(p.context.ids.length).toBe(100);
    expect(p.startIndex).toBe(2);
    await clearCalls(page);
    await page.getByTestId('chart-shuffle').click();
    await expect.poll(async () => (await calls(page, 'player.play')).length).toBe(1);
    expect((await calls(page, 'player.play'))[0].p.shuffle).toBe(true);
    // a 100-row list is virtualised
    expect(await page.getByTestId('chart-line').count()).toBeLessThan(100);
  });

  test('the chart source chosen on Home opens on the Charts page', async ({ page }) => {
    await boot(page);
    await page.getByRole('tab', { name: 'NhacCuaTui' }).first().click();
    await page.getByTestId('charts-all').click();
    await expect(page.getByTestId('charts-page')).toBeVisible();
    await expect(page.getByTestId('chart-count')).toContainText('100');
    await expect(page.getByRole('heading').or(page.locator('.chp-head .t28')).first()).toContainText('NCT');
  });
});

test.describe('long tasks', () => {
  test.use({ viewport: { width: 1536, height: 960 }, deviceScaleFactor: 2.5 });

  test('Home top to bottom wheel scroll: 0 long tasks (> 50 ms)', async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId('shelf-section').first()).toBeVisible();
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      (window as any).__long = [];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => (window as any).__long.push(e.duration))).observe({ entryTypes: ['longtask'] });
    });
    await page.mouse.move(700, 500);
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(300);
    const long = (await page.evaluate(() => (window as any).__long)) as number[];
    expect(long.filter((d) => d > 50)).toEqual([]);
  });
});
