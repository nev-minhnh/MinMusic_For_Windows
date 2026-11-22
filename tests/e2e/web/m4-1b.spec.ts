import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// E-50 .. E-52 (M4-1b) on the `web` project (Vite + mock-core): every key of a page rendered once, search, live theme/language.
// Ports 5191 / 48011 (waves.md): MM_WEB_PORT=5191 MOCK_PORT=48011.
const ROOT = path.resolve(__dirname, '../../..');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'mock-core/fixtures/settings/schema.json'), 'utf8')).entries as { key: string; platform?: string }[];
const layoutSrc = fs.readFileSync(path.join(ROOT, 'ui/src/pages/Settings/layout.ts'), 'utf8');
const shots = path.join(ROOT, '.testdata', 'm4-1b', 'shots');
fs.mkdirSync(shots, { recursive: true });

/** layout keys per page, read from the generated layout table (Android-only keys excluded, like the UI does) */
function layoutKeys(page: string): string[] {
  const body = layoutSrc.split(new RegExp(`^  ${page}: \\[`, 'm'))[1].split(/^  \],/m)[0];
  const android = new Set(schema.filter((e) => e.platform === 'android').map((e) => e.key));
  return [...body.matchAll(/\{ key: "(\w+)"/g)].map((m) => m[1]).filter((k) => !android.has(k));
}

test.use({ viewport: { width: 1440, height: 900 } });

async function openSettings(page: Page, cat?: string) {
  await page.goto('/');
  await expect(page.locator('[data-testid="home"]')).toBeVisible();
  await page.keyboard.press('Control+,');
  const shell = page.locator('[data-testid="settings"]:visible');
  await expect(shell).toBeVisible();
  if (cat) await shell.locator(`[data-testid="set-cat-${cat}"]`).click();
  return shell;
}

test.describe('E-50 every key rendered once on its page', () => {
  for (const cat of ['Appearance', 'Playback', 'Lyrics', 'Content', 'Privacy']) {
    test(`${cat}`, async ({ page }) => {
      const shell = await openSettings(page, cat);
      const want = layoutKeys(cat);
      expect(want.length).toBeGreaterThan(2);
      await expect(shell.locator('[data-testid="set-row"]')).toHaveCount(want.length);
      for (const k of want) await expect(shell.locator(`[data-testid="set-row"][data-setting="${k}"]`), k).toHaveCount(1);
      // Android-only keys never render
      for (const e of schema.filter((x) => x.platform === 'android').slice(0, 20)) await expect(page.locator(`[data-setting="${e.key}"]`)).toHaveCount(0);
      await page.screenshot({ path: path.join(shots, `e50-${cat.toLowerCase()}.png`) });
    });
  }

  test('Shortcuts table and About facts', async ({ page }) => {
    const shell = await openSettings(page, 'Shortcuts');
    expect(await shell.locator('[data-testid="shortcut-row"]').count()).toBeGreaterThan(25);
    await page.screenshot({ path: path.join(shots, 'e50-shortcuts.png') });
    await shell.locator('[data-testid="set-cat-About"]').click();
    await expect(shell.locator('[data-testid="about-version"]')).toHaveText(/\d+\.\d+/);
    await expect(shell.locator('[data-testid="about-dirs"] [data-dir]')).toHaveCount(5);
    await page.screenshot({ path: path.join(shots, 'e50-about.png') });
  });

  test('Equalizer category navigates to its route; the category list follows conventions order', async ({ page }) => {
    const shell = await openSettings(page);
    const order = await shell.locator('.set-cat').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
    expect(order.indexOf('set-cat-Playback')).toBeGreaterThan(order.indexOf('set-cat-Appearance'));
    expect(order.indexOf('set-cat-Equalizer')).toBeGreaterThan(order.indexOf('set-cat-Lyrics'));
    expect(order.indexOf('set-cat-About')).toBe(order.length - 1);
    await shell.locator('[data-testid="set-cat-Equalizer"]').click();
    await expect(page.locator('[data-route="equalizer"].vis, [data-route="equalizer"]:not(.hid)')).toHaveCount(1);
  });

  test('dependent rows are disabled while their switch is off', async ({ page }) => {
    const shell = await openSettings(page, 'Playback');
    const sw = shell.locator('[data-setting="crossfadeEnabled"] [role=switch]');
    if ((await sw.getAttribute('aria-checked')) === 'true') await sw.click();
    await expect(shell.locator('[data-setting="crossfadeDuration"]')).toHaveClass(/dis/);
    await expect(shell.locator('[data-setting="crossfadeDuration"] input')).toBeDisabled();
    await sw.click();
    await expect(shell.locator('[data-setting="crossfadeDuration"]')).not.toHaveClass(/dis/);
    await sw.click(); // back to the default
  });
});

test.describe('E-51 search', () => {
  test('filters rows across categories, highlights the match, Esc clears', async ({ page }) => {
    const shell = await openSettings(page, 'Appearance');
    const q = shell.locator('[data-testid="set-search"]');
    await q.fill('explicit');
    const results = shell.locator('[data-testid="set-results"]');
    await expect(results).toBeVisible();
    const rows = results.locator('[data-testid="set-row"]');
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
    for (const txt of await rows.locator('.sr-name').allTextContents()) expect(txt.toLowerCase()).toContain('explicit');
    await expect(results.locator('mark.sr-mark').first()).toHaveText(/explicit/i);
    await page.screenshot({ path: path.join(shots, 'e51-search.png') });
    // diacritic-insensitive after switching language is covered in E-52; here: no match message
    await q.fill('zzzzqq');
    await expect(shell.locator('[data-testid="set-no-match"]')).toBeVisible();
    await q.fill('explicit');
    await q.press('Escape');
    await expect(q).toHaveValue('');
    await expect(shell.locator('[data-testid="set-results"]')).toHaveCount(0);
    await expect(shell.locator('[data-testid="set-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="settings"]:visible')).toBeVisible(); // Esc only cleared, did not navigate away
  });
});

test.describe('E-52 theme and language switch live', () => {
  test('themeMode drives data-theme, appLanguage re-translates in place, settings.set is sent', async ({ page }) => {
    const shell = await openSettings(page, 'Appearance');
    const html = page.locator('html');
    const seg = (key: string) => shell.locator(`[data-setting="${key}"]`);
    try {
      await seg('themeMode').getByRole('tab', { name: /Light|Sáng/ }).click();
      await expect(html).toHaveAttribute('data-theme', 'light');
      await page.screenshot({ path: path.join(shots, 'e52-light.png') });
      await seg('themeMode').getByRole('tab', { name: /Pure black|Đen/ }).click();
      await expect(html).toHaveAttribute('data-theme', 'black');
      await seg('themeMode').getByRole('tab', { name: /System|Theo hệ thống/ }).click();
      await expect(html).not.toHaveAttribute('data-theme', /.+/);
      const calls = await page.evaluate(() => (window as any).__mmCalls.filter((c: any) => c.m === 'settings.set').map((c: any) => c.p));
      expect(calls).toEqual(expect.arrayContaining([{ values: { themeMode: 'LIGHT' } }, { values: { themeMode: 'PURE_BLACK' } }, { values: { themeMode: 'AUTO' } }]));

      await expect(shell.locator('[data-testid="set-cat-Appearance"]')).toHaveText('Appearance');
      await seg('appLanguage').getByRole('tab', { name: 'Tiếng Việt' }).click();
      await expect(shell.locator('[data-testid="set-cat-Appearance"]')).toHaveText('Giao diện');
      await expect(html).toHaveAttribute('lang', 'vi');
      await page.screenshot({ path: path.join(shots, 'e52-vi.png') });
      // diacritic-insensitive search in Vietnamese
      await shell.locator('[data-testid="set-search"]').fill('chu de');
      await expect(shell.locator('[data-setting="themeMode"]')).toBeVisible();
      await shell.locator('[data-testid="set-search"]').press('Escape');
    } finally {
      await shell.locator('[data-setting="appLanguage"]').getByRole('tab', { name: /System|Theo hệ thống/ }).click();
      await seg('themeMode').getByRole('tab', { name: /Dark|Tối/ }).click();
    }
    await expect(shell.locator('[data-testid="set-cat-Appearance"]')).toHaveText('Appearance');
  });

  test('a refused write rolls the control back (optimistic, bad_request)', async ({ page }) => {
    const shell = await openSettings(page, 'Content');
    await page.evaluate(() => {
      (window as any).__mmMock = { 'settings.set': () => { throw Object.assign(new Error('range'), { code: 'bad_request' }); } };
    });
    const sw = shell.locator('[data-setting="hideExplicit"] [role=switch]');
    const before = await sw.getAttribute('aria-checked');
    await sw.click();
    await expect(shell.locator('[data-setting="hideExplicit"] .sr-err')).toBeVisible();
    await expect(sw).toHaveAttribute('aria-checked', before!);
    await page.evaluate(() => { delete (window as any).__mmMock; });
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
    await sw.click(); // restore
    await expect(sw).toHaveAttribute('aria-checked', before!);
  });

  test('a secret shows only set / not set and is changed through lyrics.ai.setKey', async ({ page }) => {
    const shell = await openSettings(page, 'Lyrics');
    const row = shell.locator('[data-setting="lyricsAiApiKey"]');
    const state = row.locator('[data-testid="secret-state"]');
    await row.getByRole('button', { name: /Change|Đổi/ }).click();
    await row.locator('input[type=password]').fill('sk-e2e-secret');
    await row.getByRole('button', { name: /Save|Lưu/ }).click();
    await expect(state).toHaveText(/Set|Đã đặt/);
    expect(await page.locator('body').innerText()).not.toContain('sk-e2e-secret');
    const call = await page.evaluate(() => (window as any).__mmCalls.filter((c: any) => c.m === 'lyrics.ai.setKey').pop());
    expect(call.p.key).toBe('sk-e2e-secret');
    await row.getByRole('button', { name: /Remove|Gỡ/ }).click();
    await expect(state).toHaveText(/Not set|Chưa đặt/);
  });

  test('Ctrl ` opens the shortcuts sheet as a dialog, Esc closes it', async ({ page }) => {
    await openSettings(page);
    await page.keyboard.press('Control+`');
    const dlg = page.locator('[data-testid="shortcuts-dialog"]');
    await expect(dlg).toBeVisible();
    expect(await dlg.locator('[data-testid="shortcut-row"]').count()).toBeGreaterThan(25);
    await page.screenshot({ path: path.join(shots, 'e52-shortcuts-dialog.png') });
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await page.keyboard.press('Control+/');
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
  });
});
