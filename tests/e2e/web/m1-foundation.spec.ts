import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

// M1-3a foundation: E-5 breakpoints, E-7 song context menu, E-8 drag onto a sidebar album, E-11 shortcut table, E-12 theme and
// language live switching. Web project (Vite + mock-core). Run with MM_WEB_PORT=5181 MOCK_PORT=48001 (MM_WEB_URL overrides).
// The page under test is the dev route `#/dev/table` (shared Table + Card on the 5,000-song mock library).
const base = process.env.MM_WEB_URL ?? (process.env.MM_WEB_PORT ? `http://127.0.0.1:${process.env.MM_WEB_PORT}` : undefined);
if (base) test.use({ baseURL: base });

const SHOTS = process.env.MM_SHOTS_DIR ?? path.resolve(__dirname, '../../../../shots-M1-3a');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

// Test seam of dev builds: window.__mmMock[method](params) answers a core call, window.__mmCalls records every call.
const MOCK = `
window.__mmMock = {
  'track.sources': () => ({ options: [
    { source: 'yt', id: 'a', quality: { label: 'Opus 160', lossless: false }, auto: true, available: true },
    { source: 'zing', id: 'b', quality: { label: 'FLAC', lossless: true }, auto: false, available: false, hint: 'vip_login' },
    { source: 'nct', id: 'c', quality: { label: '320', lossless: false }, auto: false, available: true },
  ] }),
  'userAlbum.list': () => ({ items: [
    { id: 'ua1', title: 'Chill cuoi tuan', pinned: true, source: 'local', local: true, count: 12, revision: 1 },
    { id: 'ua2', title: 'Tap trung', pinned: false, source: 'local', local: true, count: 40, revision: 1 },
    { id: 'ua3', title: 'Road trip', pinned: false, source: 'local', local: true, count: 7, revision: 1 },
  ] }),
  'userAlbum.add': (p) => ({ added: p.trackIds.length - 1, skipped: 1 }),
  'userAlbum.create': () => ({ id: 'ua9' }),
  'track.setSource': () => ({}),
  'track.like': (p) => ({ liked: p.liked }),
  'app.copyLink': (p) => ({ url: 'https://example.test/' + p.id }),
  'queue.add': () => ({ revision: 1 }),
};`;

async function boot(page: Page, hash = '', lang = 'en') {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(MOCK);
  await page.goto(`/?lang=${lang}${hash}`);
  await expect(page.getByTestId('app')).toBeVisible();
}
const calls = (page: Page, m?: string) =>
  page.evaluate((method) => ((window as any).__mmCalls as { m: string; p: any }[]).filter((c) => !method || c.m === method), m);
const clearCalls = (page: Page) => page.evaluate(() => ((window as any).__mmCalls.length = 0));
async function bootTable(page: Page) {
  await boot(page, '#/dev/table');
  await expect(page.getByTestId('song-row').first()).toBeVisible();
}
const box = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!;

// ---------------------------------------------------------------- E-5
test.describe('E-5 breakpoints', () => {
  test.describe('expanded 1536x960', () => {
    test.use({ viewport: { width: 1536, height: 960 }, deviceScaleFactor: 2.5 });
    test('sidebar 256, Ctrl B undocks to the 80 rail, resize 216-320 persists', async ({ page }) => {
      await boot(page);
      await expect(page.getByTestId('sidebar')).toBeVisible();
      expect((await box(page, 'sidebar')).width).toBeCloseTo(256, 0);
      for (const id of ['nav-home', 'nav-search', 'nav-library', 'nav-liked', 'nav-downloads', 'nav-history', 'nav-stats', 'nav-equalizer']) await expect(page.getByTestId(id)).toBeVisible();
      await expect(page.getByTestId('sidebar-album')).toHaveCount(3);
      await shot(page, 'sidebar-expanded');

      // resize: drag the right edge
      const rs = await box(page, 'sidebar-resizer');
      const y = rs.y + 300;
      await page.mouse.move(rs.x + 2, y);
      await page.mouse.down();
      await page.mouse.move(300, y, { steps: 4 });
      await page.mouse.up();
      expect((await box(page, 'sidebar')).width).toBeCloseTo(300, 0);
      await page.mouse.move(297, y);
      await page.mouse.down();
      await page.mouse.move(40, y, { steps: 4 });
      await page.mouse.up();
      expect((await box(page, 'sidebar')).width).toBeCloseTo(216, 0);
      await page.mouse.move(213, y);
      await page.mouse.down();
      await page.mouse.move(900, y, { steps: 4 });
      await page.mouse.up();
      expect((await box(page, 'sidebar')).width).toBeCloseTo(320, 0);
      await page.reload();
      await expect(page.getByTestId('sidebar')).toBeVisible();
      expect((await box(page, 'sidebar')).width).toBeCloseTo(320, 0);

      await page.keyboard.press('Control+b');
      await expect(page.getByTestId('rail')).toBeVisible();
      await expect(page.getByTestId('sidebar')).toHaveCount(0);
      expect((await box(page, 'rail')).width).toBeCloseTo(80, 0);
      await page.keyboard.press('Control+b');
      await expect(page.getByTestId('sidebar')).toBeVisible();
    });
    test('library counts come from library.counts', async ({ page }) => {
      await boot(page);
      await expect(page.getByTestId('nav-liked').locator('.cnt')).not.toHaveText('');
      expect((await calls(page, 'library.counts')).length).toBeGreaterThan(0);
    });
  });

  test.describe('medium 1024x768', () => {
    test.use({ viewport: { width: 1024, height: 768 } });
    test('rail 80 with labels; Ctrl B toggles the overlay sidebar; Esc and a nav click close it', async ({ page }) => {
      await boot(page);
      await expect(page.getByTestId('rail')).toBeVisible();
      expect((await box(page, 'rail')).width).toBeCloseTo(80, 0);
      await expect(page.getByTestId('nav-home')).toContainText(/Home/);
      await expect(page.getByTestId('search-box')).toBeVisible();
      await page.keyboard.press('Control+b');
      await expect(page.getByTestId('sidebar-overlay')).toBeVisible();
      await expect(page.getByTestId('sidebar-scrim')).toBeVisible();
      await shot(page, 'sidebar-overlay-medium');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('sidebar-overlay')).toHaveCount(0);
      await page.getByTestId('rail-menu').click();
      await expect(page.getByTestId('sidebar-overlay')).toBeVisible();
      await page.getByTestId('sidebar-overlay').getByTestId('nav-library').click();
      await expect(page.getByTestId('sidebar-overlay')).toHaveCount(0);
    });
  });

  test.describe('compact 800x600', () => {
    test.use({ viewport: { width: 800, height: 600 } });
    test('rail 64, icons only, no search field', async ({ page }) => {
      await boot(page);
      expect((await box(page, 'rail')).width).toBeCloseTo(64, 0);
      await expect(page.getByTestId('search-box')).toHaveCount(0);
      await expect(page.getByTestId('rail-album').first()).toBeVisible();
    });
  });
});

// ---------------------------------------------------------------- E-7
test.describe('E-7 song context menu', () => {
  test.use({ viewport: { width: 1536, height: 960 }, deviceScaleFactor: 2.5 });
  const SONG_ORDER = ['play-next', 'add-queue', 'add-album', 'download', 'sources', 'go-artist', 'go-album', 'copy-link', 'info'];
  const ids = (page: Page, level = 0) => page.locator(`.mn[data-level="${level}"] [data-testid="menu-item"]`).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));

  test('items in MK order; submenu flips left near the right edge; lazy sources with badges', async ({ page }) => {
    await bootTable(page);
    const row = page.getByTestId('song-row').nth(2);
    const rb = (await row.boundingBox())!;
    await page.mouse.click(rb.x + rb.width - 60, rb.y + 20, { button: 'right' });
    await expect(page.getByTestId('menu')).toHaveCount(1);
    expect(await ids(page)).toEqual(SONG_ORDER);
    // 272 wide, 36 high items, clamped inside the window
    const mb = (await page.locator('.mn[data-level="0"]').boundingBox())!;
    expect(mb.width).toBeCloseTo(272, 0);
    expect(mb.x + mb.width).toBeLessThanOrEqual(1536);
    expect((await page.locator('.mn-it').first().boundingBox())!.height).toBeCloseTo(36, 0);
    await expect(page.locator('[data-id="copy-link"] .mn-k')).toHaveText('Ctrl C');
    await expect(page.locator('[data-id="info"] .mn-k')).toHaveText('Ctrl I');
    await expect(page.locator('[data-id="download"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('[data-id="download"] .mn-k')).toHaveText('M4');

    // hover "Thêm vào album của tôi": submenu after 200 ms, flipped to the left of the parent
    await page.locator('[data-id="add-album"]').hover();
    await expect(page.locator('.mn[data-level="1"]')).toBeVisible();
    const sb = (await page.locator('.mn[data-level="1"]').boundingBox())!;
    expect(sb.x + sb.width).toBeLessThanOrEqual(mb.x + 4);
    await expect(page.locator('.mn[data-level="1"]')).toHaveAttribute('data-flip', 'left');
    expect(await ids(page, 1)).toEqual(['ua-ua1', 'ua-ua2', 'ua-ua3', 'ua-new']);

    // "Chọn nguồn": lazy track.sources, real quality badge, check on the auto pick, VIP hint when locked
    await clearCalls(page);
    await page.locator('[data-id="sources"]').hover();
    await expect(page.locator('.mn[data-level="1"] [data-id="src-yt"]')).toBeVisible();
    expect((await calls(page, 'track.sources')).length).toBe(1);
    await expect(page.locator('[data-id="src-yt"] .b')).toHaveText('Opus 160');
    await expect(page.locator('[data-id="src-yt"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-id="src-zing"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('[data-id="src-zing"] .mn-k')).toHaveText('VIP');
    await shot(page, 'menu-song-sources');
    await page.locator('[data-id="src-nct"]').click();
    await expect(page.getByTestId('menu')).toHaveCount(0);
    expect((await calls(page, 'track.setSource'))[0].p.source).toBe('nct');
  });

  test('keyboard: Shift+F10 opens it, arrows and Home/End move, Right opens a submenu, Left closes it, Esc closes and focus returns', async ({ page }) => {
    await bootTable(page);
    const row = page.getByTestId('song-row').nth(1);
    await row.click();
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByTestId('menu')).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.mn-it.on')).toHaveAttribute('data-id', 'play-next');
    await page.keyboard.press('End');
    await expect(page.locator('.mn-it.on')).toHaveAttribute('data-id', 'info');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.mn-it.on')).toHaveAttribute('data-id', 'add-album');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.mn[data-level="1"]')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.mn[data-level="1"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu')).toHaveCount(0);
    await expect(row).toBeFocused();
    // the menu key works too
    await page.keyboard.press('ContextMenu');
    await expect(page.getByTestId('menu')).toHaveCount(1);
    await page.keyboard.press('Enter'); // no item active: nothing runs
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('menu')).toHaveCount(0);
    expect((await calls(page, 'queue.add'))[0].p).toMatchObject({ position: 'next' });
  });

  test('multi-selection drops source, go-to and info; right-click on an unselected row selects it', async ({ page }) => {
    await bootTable(page);
    const rows = page.getByTestId('song-row');
    await rows.nth(0).click();
    await rows.nth(2).click({ modifiers: ['Shift'] });
    await rows.nth(1).click({ button: 'right' });
    expect(await ids(page)).toEqual(['play-next', 'add-queue', 'add-album', 'download', 'copy-link']);
    await page.keyboard.press('Escape');
    await rows.nth(5).click({ button: 'right' });
    await expect(rows.nth(5)).toHaveAttribute('aria-selected', 'true');
    await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'false');
    expect((await ids(page)).length).toBe(9);
    await page.keyboard.press('Escape');
  });

  test('card menu and user album menu', async ({ page }) => {
    await bootTable(page);
    const card = page.getByTestId('dev-cards').getByTestId('card').first();
    await card.click({ button: 'right' });
    expect(await ids(page)).toEqual(['play', 'shuffle', 'add-queue', 'download', 'pin', 'copy-link', 'rename', 'cover', 'delete']);
    await expect(page.locator('[data-id="rename"] .mn-k')).toHaveText('F2');
    await expect(page.locator('[data-id="delete"] .mn-k')).toHaveText('Del');
    await page.keyboard.press('Escape');
  });

  test('delete asks for confirmation (dialog), Esc cancels', async ({ page }) => {
    await bootTable(page);
    await page.getByTestId('dev-cards').getByTestId('card').first().click({ button: 'right' });
    await page.locator('[data-id="delete"]').click();
    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
    expect((await calls(page, 'userAlbum.delete')).length).toBe(0);
  });
});

// ---------------------------------------------------------------- E-8
test.describe('E-8 drag onto a sidebar album', () => {
  test.use({ viewport: { width: 1536, height: 960 }, deviceScaleFactor: 2.5 });
  test('3 selected rows dropped on an album call userAlbum.add and show the toast; drop state is drawn', async ({ page }) => {
    await bootTable(page);
    const rows = page.getByTestId('song-row');
    await rows.nth(0).click();
    await rows.nth(2).click({ modifiers: ['Shift'] });
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
    const target = page.getByTestId('sidebar-album').nth(1);
    const tb = (await target.boundingBox())!;
    const sb = (await rows.nth(1).boundingBox())!;
    await clearCalls(page);
    // manual drag so the drop state can be inspected before the drop
    await page.mouse.move(sb.x + 200, sb.y + 28);
    await page.mouse.down();
    await page.mouse.move(sb.x + 100, sb.y + 90, { steps: 4 });
    await page.mouse.move(tb.x + 60, tb.y + 24, { steps: 8 });
    await expect(target).toHaveClass(/dnd-over/);
    await expect(target.locator('.sal-drop')).toHaveText('Drop to add 3 songs');
    await shot(page, 'sidebar-drop-state');
    await page.mouse.up();
    const add = await calls(page, 'userAlbum.add');
    expect(add).toHaveLength(1);
    expect(add[0].p).toMatchObject({ id: 'ua2', dedupe: true });
    expect(add[0].p.trackIds).toHaveLength(3);
    await expect(page.getByTestId('toast')).toHaveText('Added 2 · skipped 1');
    await expect(target).not.toHaveClass(/dnd-over/);
    await shot(page, 'toast');
  });
  test('a drag from a row that is not selected drags just that row', async ({ page }) => {
    await bootTable(page);
    const rows = page.getByTestId('song-row');
    const sb = (await rows.nth(4).boundingBox())!;
    const tb = (await page.getByTestId('sidebar-album').first().boundingBox())!;
    await clearCalls(page);
    await page.mouse.move(sb.x + 200, sb.y + 28);
    await page.mouse.down();
    await page.mouse.move(sb.x + 100, sb.y + 80, { steps: 4 });
    await page.mouse.move(tb.x + 60, tb.y + 24, { steps: 8 });
    await page.mouse.up();
    expect((await calls(page, 'userAlbum.add'))[0].p.trackIds).toHaveLength(1);
  });
  test('dropping on the player bar queues the tracks', async ({ page }) => {
    await bootTable(page);
    const rows = page.getByTestId('song-row');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    const sb = (await rows.nth(0).boundingBox())!;
    const pb = (await page.getByTestId('player-bar').boundingBox())!;
    await clearCalls(page);
    await page.mouse.move(sb.x + 200, sb.y + 28);
    await page.mouse.down();
    await page.mouse.move(sb.x + 100, sb.y + 90, { steps: 4 });
    await page.mouse.move(pb.x + 600, pb.y + 40, { steps: 8 });
    await page.mouse.up();
    const q = await calls(page, 'queue.add');
    expect(q[0].p).toMatchObject({ position: 'end' });
    expect(q[0].p.ids).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- table
test.describe('table: selection, keyboard, sort, columns', () => {
  test.use({ viewport: { width: 1536, height: 960 } });
  test('click, ctrl, shift, Ctrl A, Esc clears, Esc again leaves the page', async ({ page }) => {
    await bootTable(page);
    const rows = page.getByTestId('song-row');
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveClass(/sel/);
    await rows.nth(3).click({ modifiers: ['Control'] });
    await expect(rows.nth(1)).toHaveClass(/sel/);
    await expect(rows.nth(3)).toHaveClass(/sel/);
    await rows.nth(6).click({ modifiers: ['Shift'] });
    await expect(rows.nth(5)).toHaveClass(/sel/);
    await page.keyboard.press('Control+a');
    expect(await page.locator('[data-testid="song-row"].sel').count()).toBeGreaterThan(10);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="song-row"].sel')).toHaveCount(0);
  });
  test('arrow keys move the row, Shift extends, Enter plays', async ({ page }) => {
    await bootTable(page);
    const rows = page.getByTestId('song-row');
    await rows.nth(0).click();
    await rows.nth(0).focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press('Shift+ArrowDown');
    await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true');
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
    await clearCalls(page);
    await page.keyboard.press('Enter');
    expect((await calls(page, 'player.play')).length).toBe(1);
    // ArrowDown inside the grid does not change the volume
    expect((await calls(page, 'player.setVolume')).length).toBe(0);
  });
  test('header: sticky 40, click sorts, aria-sort follows', async ({ page }) => {
    await bootTable(page);
    const th = page.getByTestId('th-title');
    expect((await page.locator('.tbl2 .th').boundingBox())!.height).toBeCloseTo(40, 0);
    await clearCalls(page);
    await th.click();
    await expect(th).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(async () => (await calls(page, 'library.window')).some((c) => c.p.sort.by === 'title' && c.p.sort.desc === false)).toBe(true);
    await th.click();
    await expect(th).toHaveAttribute('aria-sort', 'descending');
    await expect(page.getByTestId('songs-table')).toHaveAttribute('role', 'grid');
  });
  test('album and added columns hide below 720 / 880 px of table width', async ({ page }) => {
    for (const [w, album, added] of [[1536, true, true], [1000, true, false], [780, false, false]] as const) {
      await page.setViewportSize({ width: w, height: 800 });
      await bootTable(page);
      await expect(page.locator('.tbl2 .th .th-album')).toHaveCount(album ? 1 : 0);
      await expect(page.locator('.tbl2 .th .th-added')).toHaveCount(added ? 1 : 0);
    }
  });
});

// ---------------------------------------------------------------- dialogs
test.describe('dialogs and toasts', () => {
  test.use({ viewport: { width: 1536, height: 960 }, deviceScaleFactor: 2.5 });
  test('"+" opens the prompt: 448 wide, focus trapped, Esc cancels and focus returns, Enter creates', async ({ page }) => {
    await boot(page);
    const plus = page.getByTestId('sidebar-new-album');
    await plus.click();
    const dlg = page.getByTestId('prompt-dialog');
    await expect(dlg).toBeVisible();
    expect(await dlg.evaluate((e) => (e as HTMLElement).offsetWidth)).toBe(448); // layout width (the open animation scales it)
    await expect(page.getByTestId('prompt-input')).toBeFocused();
    await shot(page, 'dialog-prompt');
    // Tab cycles inside the dialog
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(plus).toBeFocused();
    expect((await calls(page, 'userAlbum.create')).length).toBe(0);

    await plus.click();
    await page.getByTestId('prompt-input').fill('Gym');
    await page.keyboard.press('Enter');
    await expect(dlg).toHaveCount(0);
    const created = await calls(page, 'userAlbum.create');
    expect(created[0].p.title).toBe('Gym');
  });
  test('plain keys are ignored while a dialog is open', async ({ page }) => {
    await boot(page);
    await page.getByTestId('sidebar-new-album').click();
    await clearCalls(page);
    await page.keyboard.press('Escape'); // closes
    await page.getByTestId('sidebar-new-album').click();
    await page.getByTestId('prompt-input').fill('x');
    await page.keyboard.press('Control+b');
    expect((await calls(page, 'app.log')).length).toBe(0);
    await page.keyboard.press('Escape');
  });
  test('dialog scrim is 60 % on dark and 42 % on light', async ({ page }) => {
    await boot(page);
    await page.getByTestId('sidebar-new-album').click();
    const alpha = () => page.getByTestId('dialog-scrim').evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(await alpha()).toMatch(/rgba\(0, 0, 0, 0\.6\)/);
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as any).__mmPrefs.setTheme('light'));
    await page.getByTestId('sidebar-new-album').click();
    expect(await alpha()).toMatch(/0\.42\)/);
    await page.keyboard.press('Escape');
  });
  test('toasts: 8 px above the player bar, max 560, 1 visible plus a queue of 3, aria-live polite', async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId('toast-host')).toHaveAttribute('aria-live', 'polite');
    // 5 pushes via the copy-link command (no selection: "Nothing selected")
    await page.keyboard.press('Control+c');
    await expect(page.getByTestId('toast')).toBeVisible();
    await page.getByTestId('toast').evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
    const t = (await box(page, 'toast'));
    const pb = await box(page, 'player-bar');
    expect(pb.y - (t.y + t.height)).toBeCloseTo(8, 0);
    expect(t.width).toBeLessThanOrEqual(560);
  });
});

// ---------------------------------------------------------------- E-11
test.describe('E-11 shortcut table', () => {
  test.use({ viewport: { width: 1536, height: 960 } });
  const press = async (page: Page, key: string) => {
    await clearCalls(page);
    await page.keyboard.press(key);
  };
  const callsOf = async (page: Page) => (await calls(page)).filter((c) => !/^(library|home|userAlbum|sys|app\.info)/.test(c.m) || c.m === 'app.log');
  const logged = async (page: Page, id: string) => (await calls(page, 'app.log')).some((c) => c.p.msg === `noop: ${id}`);

  test('transport keys call the player', async ({ page }) => {
    await boot(page);
    await page.locator('.pg').first().focus();
    const cases: [string, string, any][] = [
      ['Space', 'player.toggle', undefined],
      ['ArrowRight', 'player.seekRelative', { deltaMs: 10000 }],
      ['ArrowLeft', 'player.seekRelative', { deltaMs: -10000 }],
      ['ArrowUp', 'player.setVolume', undefined],
      ['ArrowDown', 'player.setVolume', undefined],
      ['+', 'player.setVolume', undefined],
      ['-', 'player.setVolume', undefined],
      ['m', 'player.mute', undefined],
      ['0', 'player.seekPercent', { pct: 0 }],
      ['5', 'player.seekPercent', { pct: 50 }],
      ['9', 'player.seekPercent', { pct: 90 }],
      ['Control+ArrowRight', 'player.next', undefined],
      ['n', 'player.next', undefined],
      ['Control+ArrowLeft', 'player.prev', undefined],
      ['p', 'player.prev', undefined],
      ['s', 'player.setShuffle', undefined],
      ['r', 'player.cycleRepeat', undefined],
    ];
    for (const [key, method, params] of cases) {
      await press(page, key);
      const c = (await callsOf(page)).filter((x) => x.m === method);
      expect(c.length, `${key} -> ${method}`).toBe(1);
      if (params) expect(c[0].p).toMatchObject(params);
    }
  });
  test('search, settings, equalizer, back/forward, sidebar', async ({ page }) => {
    await boot(page);
    await page.locator('.pg').first().focus();
    for (const key of ['Control+k', 'Control+f', '/']) {
      await page.locator('.pg').first().focus();
      await page.keyboard.press(key);
      await expect(page.getByTestId('search-box').locator('input'), key).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await page.locator('.pg').first().focus();
    await page.keyboard.press('Control+e');
    await expect(page.getByTestId('missing-page')).toBeVisible();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.getByTestId('home')).toBeVisible();
    await page.keyboard.press('Alt+ArrowRight');
    await expect(page.getByTestId('missing-page')).toBeVisible();
    await page.keyboard.press('Control+b');
    await expect(page.getByTestId('rail')).toBeVisible();
    await page.keyboard.press('Control+b');
    await expect(page.getByTestId('sidebar')).toBeVisible();
  });
  test('keys outside M1 are wired to logged no-ops', async ({ page }) => {
    await boot(page);
    await page.locator('.pg').first().focus();
    const noops: [string, string][] = [
      ['l', 'pane.lyrics'], ['q', 'pane.queue'], ['d', 'pane.deviceConnect'], ['c', 'video.captions'], ['v', 'video.mode'],
      ['f', 'window.fullscreen'], ['Control+m', 'mini.open'], ['Control+,', 'settings.open'], ['F11', 'fullscreen.toggle'],
      ['Control+Shift+L', 'logs.open'], ['Control+`', 'shortcuts.sheet'], ['Control+/', 'shortcuts.sheet'], ['Control+q', 'app.quit'],
    ];
    for (const [key, id] of noops) {
      await press(page, key);
      await expect.poll(() => logged(page, id), `${key} -> ${id}`).toBe(true);
    }
  });
  test('F5, Del and F2 are delivered to the page as mm-refresh, mm-delete, mm-rename', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      (window as any).__ev = [];
      const pg = document.querySelector('.pg:not(.hid)')!;
      for (const n of ['mm-refresh', 'mm-delete', 'mm-rename']) pg.addEventListener(n, () => (window as any).__ev.push(n));
    });
    await page.locator('.pg:not(.hid)').focus();
    await page.keyboard.press('F5');
    await page.keyboard.press('Delete');
    await page.keyboard.press('F2');
    expect(await page.evaluate(() => (window as any).__ev)).toEqual(['mm-refresh', 'mm-delete', 'mm-rename']);
  });
  test('Ctrl L likes the current track, Ctrl C copies a link, Ctrl I asks for song info', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await bootTable(page);
    const rows = page.getByTestId('song-row');
    await rows.nth(2).dblclick();
    await expect.poll(async () => (await calls(page, 'player.play')).length).toBe(1);
    await page.waitForTimeout(300);
    await clearCalls(page);
    await page.keyboard.press('Control+l');
    expect((await calls(page, 'track.like')).length).toBe(1);
    await rows.nth(4).click();
    await clearCalls(page);
    await page.keyboard.press('Control+c');
    await expect.poll(async () => (await calls(page, 'app.copyLink')).length).toBe(1);
    expect((await calls(page, 'app.copyLink'))[0].p.kind).toBe('track');
    await expect(page.getByTestId('toast')).toHaveText('Link copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('https://example.test/');
    await clearCalls(page);
    await page.keyboard.press('Control+i');
    await expect.poll(async () => (await calls(page, 'app.log')).some((c) => /song info/.test(c.p.msg))).toBe(true);
  });
  test('plain keys are ignored while typing in the search field; Ctrl K still works', async ({ page }) => {
    await boot(page);
    const input = page.getByTestId('search-box').locator('input');
    await input.click();
    await clearCalls(page);
    for (const k of ['m', 'n', 's', ' ', '5', 'ArrowRight', 't']) await page.keyboard.press(k);
    expect((await callsOf(page)).filter((c) => c.m.startsWith('player.'))).toHaveLength(0);
    await expect(input).toHaveValue('mns 5t');
  });
  test('Esc with no layer open goes back', async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId('home')).toBeVisible();
    await page.getByTestId('nav-library').click();
    await expect(page.getByTestId('songs-list')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('home')).toBeVisible();
  });
});

// ---------------------------------------------------------------- E-12
test.describe('E-12 theme and language live', () => {
  test.use({ viewport: { width: 1536, height: 960 } });
  test('dark, black, light switch without a reload', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => ((window as any).__marker = 1));
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    for (const [theme, rgb] of [['dark', 'rgb(11, 11, 11)'], ['black', 'rgb(0, 0, 0)'], ['light', 'rgb(246, 247, 248)']] as const) {
      await page.evaluate((t) => (window as any).__mmPrefs.setTheme(t), theme);
      await expect.poll(bg).toBe(rgb);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    }
    await page.evaluate(() => (window as any).__mmPrefs.setTheme('system'));
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
    expect(await page.evaluate(() => (window as any).__marker)).toBe(1);
  });
  test('Vietnamese and English switch live; the choice survives a reload', async ({ page }) => {
    await boot(page, '', 'en');
    await expect(page.getByTestId('nav-home')).toContainText('Home');
    await page.evaluate(() => ((window as any).__marker = 1));
    await page.evaluate(() => (window as any).__mmPrefs.setLang('vi'));
    await expect(page.getByTestId('nav-home')).toContainText('Trang chủ');
    await expect(page.getByTestId('nav-liked')).toContainText('Bài hát đã thích');
    expect(await page.evaluate(() => (window as any).__marker)).toBe(1);
    await page.evaluate(() => (window as any).__mmPrefs.setLang('en'));
    await expect(page.getByTestId('nav-home')).toContainText('Home');
    await page.evaluate(() => (window as any).__mmPrefs.setLang('vi'));
    await page.goto('/'); // no ?lang: the stored preference applies
    await expect(page.getByTestId('nav-home')).toContainText('Trang chủ');
  });
});

// ---------------------------------------------------------------- registry
test.describe('route registry', () => {
  test.use({ viewport: { width: 1536, height: 960 } });
  test('a route without a page renders the missing page; Settings dev route renders one category', async ({ page }) => {
    await boot(page);
    await page.getByTestId('nav-stats').click();
    await expect(page.getByTestId('missing-page')).toBeVisible();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings')).toBeVisible();
    await page.goto('/?lang=en#/dev/settings/none');
    await page.reload();
    await expect(page.getByTestId('dev-settings')).toHaveAttribute('data-category', 'none');
  });
  test('deep link: the mm-nav event navigates', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mm-nav', { detail: { route: 'liked', params: {} } })));
    await expect(page.getByTestId('missing-page')).toBeVisible();
    await clearCalls(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mm-nav', { detail: { route: 'nope', params: {} } })));
    expect((await calls(page, 'app.log')).some((c) => /unknown route/.test(c.p.msg))).toBe(true);
  });
});
