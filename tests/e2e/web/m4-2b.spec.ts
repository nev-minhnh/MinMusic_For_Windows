import { test, expect, type Page } from '@playwright/test';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';

// E-53 (M4-2b): folder change through a dialog stub, the Downloads page queue flows, the Library downloads box on the page,
// Storage settings. `web` project: Vite + mock-core on ports 5194 / 48014 (waves.md): MM_WEB_PORT=5194 MOCK_PORT=48014.
// Downloads are started over a second websocket to the mock (the song/card menus are wired at INT-W4).
const ROOT = path.resolve(__dirname, '../../..');
const shots = path.join(ROOT, '.testdata', 'm4-2b', 'shots');
fs.mkdirSync(shots, { recursive: true });
const MOCK_PORT = Number(process.env.MOCK_PORT) || 48014;

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: 'serial' });

// ---- side channel to the mock core
let ws: WebSocket;
let nextId = 1;
const pending = new Map<number, (m: any) => void>();
function rpc(m: string, p?: unknown): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.e ? reject(new Error(`${m}: ${msg.e.code}`)) : resolve(msg.r)));
    ws.send(JSON.stringify({ id, m, ...(p === undefined ? {} : { p }) }));
  });
}
const hash32 = (s: string) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
};
/** songs not downloaded yet; `failing` picks the ones the mock fails once (id hash % 5 == 0) */
async function fresh(n: number, failing: boolean, skip = 0): Promise<string[]> {
  const w = await rpc('library.window', { list: 'songs', sort: { by: 'added', desc: true }, filter: { downloaded: false }, offset: skip, limit: 200 });
  return w.items.map((t: any) => t.id).filter((id: string) => (hash32(id) % 5 === 0) === failing).slice(0, n);
}

test.beforeAll(async () => {
  ws = new WebSocket(`ws://127.0.0.1:${MOCK_PORT}/rpc`);
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  ws.on('message', (d) => {
    const msg = JSON.parse(d.toString());
    if (typeof msg.id === 'number') { pending.get(msg.id)?.(msg); pending.delete(msg.id); }
  });
  await rpc('sys.hello', { token: 'dev', role: 'ui', protocol: 1, client: 'e2e', locale: 'en' });
});
test.afterAll(() => ws?.close());
test.afterEach(async () => {
  await rpc('download.cancel', { all: true }).catch(() => {});
  await rpc('download.resume').catch(() => {});
  await rpc('download.setFolder', { path: null }).catch(() => {});
});

async function openDownloads(page: Page) {
  await page.goto('/');
  await expect(page.locator('[data-testid="home"]')).toBeVisible();
  await page.locator('[data-testid="nav-downloads"]').first().click();
  const pg = page.locator('[data-testid="downloads-page"]:visible');
  await expect(pg).toBeVisible();
  return pg;
}
async function openSettings(page: Page, cat: string) {
  await page.goto('/');
  await expect(page.locator('[data-testid="home"]')).toBeVisible();
  await page.keyboard.press('Control+,');
  const shell = page.locator('[data-testid="settings"]:visible');
  await expect(shell).toBeVisible();
  await shell.locator(`[data-testid="set-cat-${cat}"]`).click();
  return shell;
}
const calls = (page: Page, m: string) => page.evaluate((mm) => (window as any).__mmCalls.filter((c: any) => c.m === mm).map((c: any) => c.p), m);
const stubPick = (page: Page, value: string | null) => page.evaluate((v) => { (window as any).__mmPickFolder = () => v; }, value);

test.describe('E-53 download folder', () => {
  test('choose a folder through the dialog stub, errors inline, "Mặc định" resets to null', async ({ page }) => {
    const shell = await openSettings(page, 'Downloads');
    const path_ = shell.locator('[data-testid="dl-set-path"]');
    await expect(shell.locator('[data-testid="set-page"][data-page="Downloads"]')).toBeVisible();
    await expect(path_).toContainText('MinMusic');

    await stubPick(page, 'D:\\Nhac\\MinMusic');
    await shell.locator('[data-testid="dl-set-pick"]').click();
    await expect(path_).toHaveText('D:\\Nhac\\MinMusic');
    expect(await calls(page, 'download.setFolder')).toEqual([{ path: 'D:\\Nhac\\MinMusic' }]);
    await page.screenshot({ path: path.join(shots, 'e53-folder-ok.png') });

    await stubPick(page, 'D:\\readonly\\Music');
    await shell.locator('[data-testid="dl-set-pick"]').click();
    await expect(shell.locator('[data-testid="dl-set-error"]')).toHaveAttribute('data-error', 'not_writable');
    await expect(shell.locator('[data-testid="dl-set-error"]')).toContainText('not writable');
    await expect(path_).toHaveText('D:\\Nhac\\MinMusic'); // unchanged
    await page.screenshot({ path: path.join(shots, 'e53-folder-error.png') });

    await stubPick(page, 'Z:\\missing\\Music');
    await shell.locator('[data-testid="dl-set-pick"]').click();
    await expect(shell.locator('[data-testid="dl-set-error"]')).toHaveAttribute('data-error', 'missing');

    await shell.locator('[data-testid="dl-set-default"]').click();
    await expect(shell.locator('[data-testid="dl-set-error"]')).toHaveCount(0);
    await expect(path_).toContainText('MinMusic');
    await expect(path_).not.toHaveText('D:\\Nhac\\MinMusic');
    expect((await calls(page, 'download.setFolder')).at(-1)).toEqual({ path: null });

    // a cancelled dialog changes nothing
    const n = (await calls(page, 'download.setFolder')).length;
    await stubPick(page, null);
    await shell.locator('[data-testid="dl-set-pick"]').click();
    expect((await calls(page, 'download.setFolder')).length).toBe(n);
  });

  test('default quality is remembered; auto-download keys are real settings rows', async ({ page }) => {
    const shell = await openSettings(page, 'Downloads');
    const sel = shell.locator('[data-testid="dl-quality-select"]');
    await expect(sel).toHaveValue('best');
    await sel.selectOption('FLAC');
    await page.reload();
    await page.keyboard.press('Control+,');
    await page.locator('[data-testid="set-cat-Downloads"]').click();
    await expect(page.locator('[data-testid="dl-quality-select"]')).toHaveValue('FLAC');
    await page.locator('[data-testid="dl-quality-select"]').selectOption('best');
    await expect(page.locator('[data-setting="autoDownloadOnLike"]')).toBeVisible();
    await expect(page.locator('[data-setting="autoDownloadSavedCollections"]')).toBeVisible();
  });

  test('the box warns when the folder is not available and changes folder from the page', async ({ page }) => {
    const pg = await openDownloads(page);
    await expect(pg.locator('[data-testid="dl-box-summary"]')).toContainText(/Downloaded · \d+ songs/);
    await expect(pg.locator('[data-testid="dl-folder-warn"]')).toHaveCount(0);
    await rpc('download.setFolder', { path: 'E:\\offline\\Music' });
    await expect(pg.locator('[data-testid="dl-folder-warn"]')).toBeVisible();
    await page.screenshot({ path: path.join(shots, 'e53-box-folder-warn.png') });
    await stubPick(page, 'D:\\Nhac\\MinMusic');
    await pg.locator('[data-testid="dl-change-folder"]').click();
    await expect(pg.locator('[data-testid="dl-folder-warn"]')).toHaveCount(0);
    await expect(pg.locator('[data-testid="dl-box-folder"]')).toContainText('D:\\Nhac\\MinMusic');
  });
});

test.describe('Downloads page', () => {
  test('box: count, size and quality bars as scaleX shares', async ({ page }) => {
    const pg = await openDownloads(page);
    const sum = await rpc('download.summary');
    await expect(pg.locator('[data-testid="dl-box-summary"]')).toContainText(`${sum.count}`);
    const bars = pg.locator('[data-testid="dl-box-bars"] .dlx-qrow');
    expect(await bars.count()).toBeGreaterThanOrEqual(2);
    const shares = await bars.locator('.dlx-fill').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.share)));
    expect(shares.every((s) => s > 0 && s <= 1)).toBe(true);
    expect(shares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1.001);
    expect(shares).toEqual([...shares].sort((a, b) => b - a));
    // the bar is a transform, not a width
    const tr = await bars.first().locator('.dlx-fill').evaluate((e) => ({ t: getComputedStyle(e).transform, w: (e as HTMLElement).style.width }));
    expect(tr.w).toBe('');
    expect(tr.t).toMatch(/^matrix\(/);
    await page.screenshot({ path: path.join(shots, 'm4-2b-downloads-page.png') });
  });

  test('Đã tải table: select, "Lưu bản sao…" uses the folder dialog, remove asks first and sends deleteFiles:true', async ({ page }) => {
    const pg = await openDownloads(page);
    const table = pg.locator('[data-testid="dl-table"]');
    await expect(table.locator('[data-testid="song-row"]').first()).toBeVisible();
    const before = (await rpc('download.summary')).count;
    await expect(pg.locator('[data-testid="dl-save-to"]')).toBeDisabled();
    const first = table.locator('[data-testid="song-row"]').first();
    const id = await rpc('download.window', { list: 'downloaded', sort: { by: 'added', desc: true }, offset: 0, limit: 1 }).then((w) => w.items[0].id);
    await first.click();
    await expect(pg.locator('[data-testid="dl-save-to"]')).toBeEnabled();

    await stubPick(page, 'D:\\Backup');
    await pg.locator('[data-testid="dl-save-to"]').click();
    await expect.poll(async () => (await calls(page, 'download.saveTo')).length).toBe(1);
    expect(await calls(page, 'download.saveTo')).toEqual([{ ids: [id], path: 'D:\\Backup' }]);
    await stubPick(page, null);
    await pg.locator('[data-testid="dl-save-to"]').click();
    expect((await calls(page, 'download.saveTo')).length).toBe(1); // cancelled dialog: nothing sent

    await pg.locator('[data-testid="dl-remove"]').click();
    await expect(page.locator('[data-testid="confirm-dialog"]')).toBeVisible();
    await page.screenshot({ path: path.join(shots, 'm4-2b-remove-confirm.png') });
    await page.keyboard.press('Escape');
    expect((await calls(page, 'download.remove')).length).toBe(0);
    await pg.locator('[data-testid="dl-remove"]').click();
    await page.locator('[data-testid="confirm-ok"]').click();
    await expect.poll(async () => (await rpc('download.summary')).count).toBe(before - 1);
    expect(await calls(page, 'download.remove')).toEqual([{ ids: [id], deleteFiles: true }]);
    await expect(pg.locator('[data-testid="dl-done-count"]')).toHaveText(String(before - 1));
    // put it back for the other tests
    await rpc('download.tracks', { ids: [id] });
  });

  test('queue: rows progress as a transform at <= 2 Hz without replacing nodes; pause freezes; cancel one; cancel all', async ({ page }) => {
    const pg = await openDownloads(page);
    await pg.locator('[data-testid="dl-queue-empty"]').waitFor({ state: 'detached' }).catch(() => {});
    const ids = await fresh(6, false);
    expect(ids.length).toBe(6);
    await pg.getByRole('tab', { name: 'Queue' }).click();
    await expect(pg.locator('[data-testid="dl-queue-empty"]')).toBeVisible();
    await rpc('download.tracks', { ids });
    const rows = pg.locator('[data-testid="dl-qrow"]');
    await expect(rows).toHaveCount(6);
    await expect(pg.locator('[data-testid="dl-box-active"] [data-testid="dl-progress-text"]')).toContainText(/Downloading 1\/6/);
    await expect(rows.first().locator('[data-testid="dl-qstate"]')).toHaveText('Downloading');

    // node identity + mutation count of the list while 2 downloads progress
    await page.evaluate(() => {
      const list = document.querySelector('[data-testid="dl-queue-list"]')!;
      (window as any).__nodes = [...list.querySelectorAll('[data-testid="dl-qrow"]')];
      (window as any).__adds = 0;
      // row nodes only: a row-local line (bytes) may appear, the list itself must not be rebuilt
      const isRow = (n: Node) => n instanceof HTMLElement && n.classList.contains('dlx-qr');
      new MutationObserver((ms) => { for (const m of ms) (window as any).__adds += [...m.addedNodes, ...m.removedNodes].filter(isRow).length; }).observe(list, { childList: true, subtree: true });
      const fill = list.querySelector('[data-testid="dl-qrow"] [data-testid="dl-qfill"]') as HTMLElement;
      (window as any).__samples = [];
      new MutationObserver(() => (window as any).__samples.push(performance.now())).observe(fill, { attributes: true, attributeFilter: ['style'] });
    });
    const p0 = Number(await rows.first().locator('[data-testid="dl-qfill"]').evaluate((e) => (e as HTMLElement).style.getPropertyValue('--s')));
    await page.waitForTimeout(2000); // shorter than one download (4 s): no row finishes inside the window
    const r = await page.evaluate(() => ({
      same: ((window as any).__nodes as Element[]).slice(0, 2).every((n) => n.isConnected),
      adds: (window as any).__adds as number,
      samples: (window as any).__samples as number[],
    }));
    const p1 = Number(await rows.first().locator('[data-testid="dl-qfill"]').evaluate((e) => (e as HTMLElement).style.getPropertyValue('--s')));
    expect(p1).toBeGreaterThan(p0);
    expect(r.same).toBe(true);
    expect(r.adds).toBe(0); // progress never adds or removes a row node
    // style writes on one fill: <= 2 Hz (+1 slack)
    expect(r.samples.length).toBeLessThanOrEqual(Math.ceil(2.0 * 2) + 2);
    expect(r.samples.length).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: path.join(shots, 'm4-2b-queue.png') });

    // pause: nothing moves, labels say so
    await pg.locator('[data-testid="dl-pause-page"]').click();
    await expect(rows.first().locator('[data-testid="dl-qstate"]')).toHaveText('Paused');
    await page.waitForTimeout(800); // a coalesced progress value may still be in flight (<= 500 ms)
    const frozen = await rows.nth(1).locator('[data-testid="dl-qfill"]').evaluate((e) => (e as HTMLElement).style.getPropertyValue('--s'));
    await page.waitForTimeout(1300);
    expect(await rows.nth(1).locator('[data-testid="dl-qfill"]').evaluate((e) => (e as HTMLElement).style.getPropertyValue('--s'))).toBe(frozen);
    await page.screenshot({ path: path.join(shots, 'm4-2b-queue-paused.png') });
    await pg.locator('[data-testid="dl-pause-page"]').click();
    await expect(pg.locator('[data-testid="dl-pause-page"]')).toContainText('Pause');

    // cancel one
    const last = rows.last();
    const lastId = await last.getAttribute('data-id');
    await last.locator('[data-testid="dl-qcancel"]').click();
    await expect(pg.locator(`[data-testid="dl-qrow"][data-id="${lastId}"]`)).toHaveCount(0);
    await expect(rows).toHaveCount(5);

    // cancel all: confirm first
    await pg.locator('[data-testid="dl-cancel-all"]').click();
    await expect(page.locator('[data-testid="confirm-dialog"]')).toBeVisible();
    await page.locator('[data-testid="confirm-ok"]').click();
    await expect(pg.locator('[data-testid="dl-queue-empty"]')).toBeVisible();
    expect(await calls(page, 'download.cancel')).toEqual([{ ids: [lastId] }, { all: true }]);
  });

  test('queue: a failing download shows its error, retry completes it', async ({ page }) => {
    const pg = await openDownloads(page);
    const [id] = await fresh(1, true);
    expect(id).toBeTruthy();
    await pg.getByRole('tab', { name: 'Queue' }).click();
    await rpc('download.tracks', { ids: [id] });
    const row = pg.locator(`[data-testid="dl-qrow"][data-id="${id}"]`);
    await expect(row).toHaveAttribute('data-state', 'failed', { timeout: 15_000 });
    await expect(row.locator('[data-testid="dl-qerr"]')).toHaveText('Network error');
    await expect(pg.locator('[data-testid="dl-retry-failed"]')).toBeEnabled();
    await expect(pg.locator('[data-testid="dl-retry-failed"]')).toContainText('(1)');
    await page.screenshot({ path: path.join(shots, 'm4-2b-queue-failed.png') });
    await row.locator('[data-testid="dl-qretry"]').click();
    await expect(row).not.toHaveAttribute('data-state', 'failed');
    expect(await calls(page, 'download.retry')).toEqual([{ ids: [id] }]);
    await expect(pg.locator(`[data-testid="dl-qrow"][data-id="${id}"]`)).toHaveCount(0, { timeout: 15_000 }); // finished
    await expect(pg.locator('[data-testid="dl-retry-failed"]')).toBeDisabled();
    await rpc('download.remove', { ids: [id], deleteFiles: true });
  });

  test('"Retry failed" retries every failed item at once', async ({ page }) => {
    const pg = await openDownloads(page);
    const ids = await fresh(2, true);
    expect(ids.length).toBe(2);
    await pg.getByRole('tab', { name: 'Queue' }).click();
    await rpc('download.tracks', { ids });
    await expect(pg.locator('[data-testid="dl-qrow"][data-state="failed"]')).toHaveCount(2, { timeout: 20_000 });
    await pg.locator('[data-testid="dl-retry-failed"]').click();
    expect(await calls(page, 'download.retry')).toEqual([{}]);
    await expect(pg.locator('[data-testid="dl-qrow"][data-state="failed"]')).toHaveCount(0);
    await rpc('download.cancel', { all: true });
  });
});

test.describe('Settings > Bộ nhớ', () => {
  test('usage bars with limits, clear asks first and calls storage.clear', async ({ page }) => {
    const shell = await openSettings(page, 'Storage');
    const rows = shell.locator('[data-testid="st-row"]');
    await expect(rows).toHaveCount(5);
    const img = shell.locator('[data-testid="st-row"][data-cache="imageCache"]');
    await expect(img.locator('[data-testid="st-used"]')).toContainText(/ of /); // used of the limit
    const s = await img.locator('[data-testid="st-fill"]').evaluate((e) => Number((e as HTMLElement).style.getPropertyValue('--s')));
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
    await expect(shell.locator('[data-setting="songCacheEnabled"]')).toBeVisible();
    await expect(shell.locator('[data-setting="maxSongCacheSize"] select')).toBeVisible();
    await page.screenshot({ path: path.join(shots, 'm4-2b-storage.png') });

    await img.locator('[data-testid="st-clear"]').click();
    await expect(page.locator('[data-testid="confirm-dialog"]')).toBeVisible();
    await page.keyboard.press('Escape');
    expect((await calls(page, 'storage.clear')).length).toBe(0);
    await img.locator('[data-testid="st-clear"]').click();
    await page.locator('[data-testid="confirm-ok"]').click();
    await expect.poll(async () => (await calls(page, 'storage.clear')).length).toBe(1);
    expect(await calls(page, 'storage.clear')).toEqual([{ what: 'imageCache' }]);
    await expect(img.locator('[data-testid="st-used"]')).toContainText(/^0 B/);
    await expect(img.locator('[data-testid="st-clear"]')).toBeDisabled();
    await page.screenshot({ path: path.join(shots, 'm4-2b-storage-cleared.png') });
  });
});

test.describe('Vietnamese and light theme screenshots', () => {
  test('Downloads page in Vietnamese on the light theme', async ({ page }) => {
    await rpc('settings.set', { values: { appLanguage: 'vi', themeMode: 'LIGHT' } });
    try {
      await page.goto('/');
      await expect(page.locator('[data-testid="home"]')).toBeVisible();
      await page.locator('[data-testid="nav-downloads"]').first().click();
      const pg = page.locator('[data-testid="downloads-page"]:visible');
      await expect(pg.locator('[data-testid="dl-box-summary"]')).toContainText('Đã tải');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await page.screenshot({ path: path.join(shots, 'm4-2b-downloads-vi-light.png') });
      await pg.getByRole('tab', { name: 'Hàng đợi' }).click();
      await rpc('download.tracks', { ids: await fresh(3, false, 20) });
      await expect(pg.locator('[data-testid="dl-qrow"]')).toHaveCount(3);
      await page.screenshot({ path: path.join(shots, 'm4-2b-queue-vi-light.png') });
      await page.keyboard.press('Control+,');
      await page.locator('[data-testid="set-cat-Downloads"]').click();
      await page.screenshot({ path: path.join(shots, 'm4-2b-settings-downloads-vi-light.png') });
    } finally {
      await rpc('settings.set', { values: { appLanguage: 'SYSTEM', themeMode: 'AUTO' } });
    }
  });
});
