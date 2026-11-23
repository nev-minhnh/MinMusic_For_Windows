import { test, expect, type Page } from '@playwright/test';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';

// E-54 .. E-55 (M4-3b) on the `web` project (Vite + mock-core): Settings > Backup (create, restore with confirm, import),
// log viewer (Ctrl Shift L), crash prompt, onboarding, first-run toast. Ports 5195 / 48015: MM_WEB_PORT=5195 MOCK_PORT=48015.
// File dialogs and app_restart are stubbed through window.__mmNative (test seam of dev/e2e builds, see Backup/native.ts).
const mockPort = Number(process.env.MOCK_PORT) || 47999; // the suite default (playwright.config.ts)
const webPort = Number(process.env.MM_WEB_PORT) || 5173; // the suite default (playwright.config.ts)
const SHOTS = process.env.MM_SHOTS_DIR ?? path.resolve(__dirname, '../../../../shots-M4-3b');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

test.use({ viewport: { width: 1440, height: 900 } });

/** One call on the mock core over its own websocket (seeds state: crash report, first run). */
function mockCall(method: string, params: unknown = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${mockPort}/rpc`, { origin: `http://127.0.0.1:${webPort}` });
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, m: 'sys.hello', p: { token: 'dev', role: 'ui', protocol: 1, client: 'e2e/0.1', locale: 'vi' } })));
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.id === 1) ws.send(JSON.stringify({ id: 2, m: method, p: params }));
      else if (m.id === 2) {
        ws.close();
        m.e ? reject(new Error(m.e.msg)) : resolve(m.r);
      }
    });
  });
}

/** Stubs for the shell commands; every call is recorded in window.__nat. */
const natives = (o: { pick?: string | null; save?: string | null }) => `
window.__nat = [];
window.__mmNative = {
  pick_file: (a) => { window.__nat.push(['pick_file', a]); return ${JSON.stringify(o.pick ?? null)}; },
  save_file: (a) => { window.__nat.push(['save_file', a]); return ${JSON.stringify(o.save ?? null)}; },
  app_restart: () => { window.__nat.push(['app_restart']); },
  open_log_folder: () => { window.__nat.push(['open_log_folder']); },
};`;

async function boot(page: Page, opts: { pick?: string | null; save?: string | null; lang?: string; init?: string } = {}) {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(natives(opts));
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(opts.lang === 'none' ? '/' : `/?lang=${opts.lang ?? 'en'}`);
  await expect(page.getByTestId('app')).toBeVisible();
}
const calls = (page: Page, m: string) => page.evaluate((x) => (window as any).__mmCalls.filter((c: any) => c.m === x), m);
const nat = (page: Page, c: string) => page.evaluate((x) => (window as any).__nat.filter((n: any) => n[0] === x), c);

async function openBackup(page: Page) {
  await page.keyboard.press('Control+,');
  const shell = page.locator('[data-testid="settings"]:visible');
  await expect(shell).toBeVisible();
  await shell.locator('[data-testid="set-cat-Backup"]').click();
  await expect(shell.locator('[data-page="Backup"]')).toBeVisible();
  return shell;
}

test.beforeEach(async () => {
  // a clean mock: no pending crash, not a first run
  await mockCall('crash.dismiss');
  await mockCall('mock.onboarding.reset', { firstRun: false });
});

test.describe('E-54 backup page', () => {
  test('create: save dialog -> backup.create -> bytes shown', async ({ page }) => {
    await boot(page, { save: 'C:\\test\\MinMusic-backup.zip' });
    await openBackup(page);
    await page.getByTestId('bk-create-btn').click();
    await expect(page.getByTestId('bk-create-status')).toContainText('Backup created');
    await expect(page.getByTestId('bk-create-status')).toContainText('MB');
    expect((await nat(page, 'save_file'))[0][1].defaultName).toMatch(/^MinMusic-backup-\d{4}-\d{2}-\d{2}\.zip$/);
    expect((await calls(page, 'backup.create'))[0].p).toEqual({ path: 'C:\\test\\MinMusic-backup.zip' });
    await shot(page, 'e54-backup-created');
  });

  test('create: cancelled dialog does nothing', async ({ page }) => {
    await boot(page, { save: null });
    await openBackup(page);
    await page.getByTestId('bk-create-btn').click();
    await expect(page.getByTestId('bk-create-btn')).toBeEnabled();
    expect(await calls(page, 'backup.create')).toHaveLength(0);
  });

  test('restore: pick -> inspect -> confirm dialog -> restore -> app_restart', async ({ page }) => {
    await boot(page, { pick: 'C:\\test\\good.zip' });
    await openBackup(page);
    await page.getByTestId('bk-restore-btn').click();
    const dlg = page.getByTestId('restore-confirm');
    await expect(dlg).toBeVisible();
    await expect(page.getByTestId('restore-platform')).toHaveText('MinMusic for Windows');
    await expect(page.getByTestId('restore-dbversion')).toHaveText('47');
    await expect(page.getByTestId('restore-created')).not.toHaveText('-');
    await expect(page.getByTestId('restore-warning')).toBeVisible();
    expect(await calls(page, 'backup.restore')).toHaveLength(0); // nothing staged before the confirmation
    await shot(page, 'e54-restore-confirm');
    await page.getByTestId('restore-ok').click();
    await expect.poll(async () => (await nat(page, 'app_restart')).length).toBe(1);
    const order = await page.evaluate(() => (window as any).__mmCalls.map((c: any) => c.m).filter((m: string) => m.startsWith('backup.')));
    expect(order).toEqual(['backup.inspect', 'backup.restore']);
  });

  test('restore: cancel in the dialog stages nothing and does not restart', async ({ page }) => {
    await boot(page, { pick: 'C:\\test\\good.zip' });
    await openBackup(page);
    await page.getByTestId('bk-restore-btn').click();
    await page.getByTestId('restore-cancel').click();
    await expect(page.getByTestId('restore-confirm')).toHaveCount(0);
    expect(await calls(page, 'backup.restore')).toHaveLength(0);
    expect(await nat(page, 'app_restart')).toHaveLength(0);
  });

  test('restore: a file the core rejects is gated (button disabled, never restored)', async ({ page }) => {
    await boot(page, { pick: 'C:\\test\\corrupt.zip' });
    await openBackup(page);
    await page.getByTestId('bk-restore-btn').click();
    await expect(page.getByTestId('restore-blocked')).toBeVisible();
    await expect(page.getByTestId('restore-ok')).toBeDisabled();
    await shot(page, 'e54-restore-blocked');
    await page.keyboard.press('Enter'); // Enter must not submit a gated dialog
    await expect(page.getByTestId('restore-confirm')).toHaveCount(0);
    expect(await calls(page, 'backup.restore')).toHaveLength(0);
    expect(await nat(page, 'app_restart')).toHaveLength(0);
  });

  test('restore: an Android backup is sent to the import path', async ({ page }) => {
    await boot(page, { pick: 'C:\\test\\android.zip' });
    await openBackup(page);
    await page.getByTestId('bk-restore-btn').click();
    await expect(page.getByTestId('restore-platform')).toHaveText('Android');
    await expect(page.getByTestId('restore-blocked')).toContainText('Import from Android');
    await expect(page.getByTestId('restore-ok')).toBeDisabled();
  });

  test('import from Android or v1: imported count shown', async ({ page }) => {
    await boot(page, { pick: 'C:\\test\\android.zip' });
    await openBackup(page);
    await page.getByTestId('bk-import-btn').click();
    await expect(page.getByTestId('bk-import-status')).toHaveText('Imported 42 items');
    expect((await calls(page, 'import.foreignBackup'))[0].p).toEqual({ path: 'C:\\test\\android.zip' });
  });

  test('import: a corrupt file shows the core error inline', async ({ page }) => {
    await boot(page, { pick: 'C:\\test\\corrupt.zip' });
    await openBackup(page);
    await page.getByTestId('bk-import-btn').click();
    await expect(page.getByTestId('bk-import-status')).toContainText('Failed');
  });

  test('Vietnamese page, light theme screenshot', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await boot(page, { lang: 'vi' });
    await openBackup(page);
    await expect(page.getByTestId('bk-create-btn')).toContainText('Tạo bản sao lưu');
    await shot(page, 'e54-backup-vi');
  });
});

test.describe('E-55 log viewer, crash prompt, onboarding', () => {
  test('Ctrl Shift L opens the viewer: 2000 lines, virtualised, tabs, level filter, copy, folder, Esc', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await boot(page);
    await page.keyboard.press('Control+Shift+L');
    const dlg = page.getByTestId('log-viewer');
    await expect(dlg).toBeVisible();
    const box = page.getByTestId('log-box');
    await expect(box).toHaveAttribute('data-rows', '2000');
    await expect(page.getByTestId('log-count')).toHaveText('2000 lines');
    // fixed 18 px rows and only a window in the DOM
    const n = await page.getByTestId('log-row').count();
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThan(120);
    const h = await page.getByTestId('log-row').first().evaluate((e) => (e as HTMLElement).offsetHeight);
    expect(h).toBe(18);
    // opens at the tail
    await expect(page.getByTestId('log-row').last()).toContainText(/event|Handler/);
    expect(await box.evaluate((e) => e.scrollTop + e.clientHeight >= e.scrollHeight - 2)).toBe(true);
    await shot(page, 'e55-log-viewer');
    // scrolling to the top renders the first line
    await box.evaluate((e) => (e.scrollTop = 0));
    await expect(page.getByTestId('log-row').first()).toContainText('event 0');
    // level filter
    await dlg.getByRole('tab', { name: 'ERROR' }).click();
    const errRows = Number(await box.getAttribute('data-rows'));
    expect(errRows).toBeGreaterThan(100);
    expect(errRows).toBeLessThan(2000);
    await expect(page.getByTestId('log-row').filter({ hasText: ' INFO ' })).toHaveCount(0);
    // tabs
    await dlg.getByRole('tab', { name: 'Shell' }).click();
    await expect(page.getByTestId('log-row').last()).toContainText('shell');
    expect((await calls(page, 'app.logs.tail')).map((c: any) => c.p.file)).toEqual(['app', 'shell']);
    expect((await calls(page, 'app.logs.tail'))[0].p.lines).toBe(2000);
    // copy
    await page.getByTestId('log-copy').click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('[shell]');
    // open folder
    await page.getByTestId('log-open-folder').click();
    expect(await nat(page, 'open_log_folder')).toHaveLength(1);
    // Esc closes
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
  });

  test('crash prompt shows the pending report; Dismiss acknowledges it', async ({ page }) => {
    await mockCall('mock.crash.raise', { summary: 'java.lang.IllegalStateException: player released twice' });
    await boot(page);
    const dlg = page.getByTestId('crash-prompt');
    await expect(dlg).toBeVisible();
    await expect(page.getByTestId('crash-summary')).toContainText('player released twice');
    await shot(page, 'e55-crash-prompt');
    await page.getByTestId('crash-open').click();
    expect(await nat(page, 'open_log_folder')).toHaveLength(1);
    await expect(dlg).toBeVisible(); // "Open folder" keeps the prompt
    await page.getByTestId('crash-dismiss').click();
    await expect(dlg).toHaveCount(0);
    await expect.poll(async () => (await calls(page, 'crash.dismiss')).length).toBe(1);
    expect((await mockCall('crash.pending')).report).toBeUndefined();
    // next start: nothing to show
    await page.reload();
    await expect(page.getByTestId('app')).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.getByTestId('crash-prompt')).toHaveCount(0);
  });

  test('onboarding on a first run: language, theme, steps, finish -> onboarding.complete -> home', async ({ page }) => {
    await mockCall('mock.onboarding.reset', { firstRun: true });
    await boot(page, { pick: 'C:\\test\\android.zip', lang: 'none' });
    const ob = page.getByTestId('onboarding');
    await expect(ob).toBeVisible();
    await expect(ob).toHaveAttribute('data-step', 'welcome');
    await shot(page, 'e55-onboarding-1-welcome');
    await ob.getByRole('tab', { name: 'Tiếng Việt' }).click();
    await expect(page.getByTestId('ob-title')).toHaveText('Chào mừng đến với MinMusic');
    await ob.getByRole('tab', { name: 'Sáng' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect((await calls(page, 'settings.set')).map((c: any) => Object.keys(c.p.values)[0])).toEqual(['appLanguage', 'themeMode']);
    await page.getByTestId('ob-next').click();
    await expect(ob).toHaveAttribute('data-step', 'sources');
    await expect(page.getByTestId('ob-open-sources')).toBeVisible();
    await shot(page, 'e55-onboarding-2-sources');
    await page.getByTestId('ob-next').click();
    await expect(ob).toHaveAttribute('data-step', 'youtube');
    await page.getByTestId('ob-skip').click();
    await expect(ob).toHaveAttribute('data-step', 'import');
    await page.getByTestId('ob-import').click();
    await expect(page.getByTestId('ob-note')).toHaveText('Đã nhập 42 mục');
    await shot(page, 'e55-onboarding-4-import');
    expect(await calls(page, 'onboarding.complete')).toHaveLength(0);
    await page.getByTestId('ob-next').click(); // "Bắt đầu nghe nhạc"
    await expect(page.locator('[data-testid="home"]:visible')).toBeVisible();
    await expect.poll(async () => (await calls(page, 'onboarding.complete')).length).toBe(1);
    expect((await mockCall('onboarding.state')).completed).toBe(true);
    await page.reload();
    await expect(page.locator('[data-testid="home"]:visible')).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.getByTestId('onboarding')).toHaveCount(0);
  });

  test('onboarding: Skip all finishes at once', async ({ page }) => {
    await mockCall('mock.onboarding.reset', { firstRun: true });
    await boot(page);
    await expect(page.getByTestId('onboarding')).toBeVisible();
    await page.getByTestId('ob-skip-all').click();
    await expect(page.locator('[data-testid="home"]:visible')).toBeVisible();
    await expect.poll(async () => (await calls(page, 'onboarding.complete')).length).toBe(1);
  });

  test('not a first run: no onboarding page', async ({ page }) => {
    await boot(page);
    await expect(page.locator('[data-testid="home"]:visible')).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.getByTestId('onboarding')).toHaveCount(0);
  });

  test('first-run toast: w2FirstRunDone false -> toast once, then settings.set {w2FirstRunDone:true}', async ({ page }) => {
    // the mock schema (generated from Settings.kt before M4-1a) has no w2FirstRunDone: answer it through the test seam
    await boot(page, {
      lang: 'vi',
      init: `window.__mmMock = {
        'settings.get': (p) => (p && p.keys && p.keys[0] === 'w2FirstRunDone' ? { values: { w2FirstRunDone: false } } : undefined),
        'settings.set': (p) => (p.values && 'w2FirstRunDone' in p.values ? {} : undefined),
      };`,
    });
    const toast = page.locator('.toast');
    await expect(toast).toContainText('Đã chuyển sang giao diện mới');
    await expect.poll(async () => (await calls(page, 'settings.set')).some((c: any) => c.p.values?.w2FirstRunDone === true)).toBe(true);
    await shot(page, 'e55-firstrun-toast');
  });
});
