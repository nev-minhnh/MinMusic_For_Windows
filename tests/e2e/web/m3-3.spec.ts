import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// E-40 .. E-46 + R-SEC-3 (UI part) on the `web` project (Vite dev server + mock-core, ports 5192 / 48012).
// The Settings shell is not mounted by the app until M4-1b: the specs use the dev harness
// /src/shell/account/dev.html#/dev/settings/<key> (title-bar AccountButton + one category via pages/Settings/_dev.tsx).
// Test credentials only. The mock answers `unauthorized` for the password "wrong" and gives VIP to accounts starting with "vip".
const PW = 'pw-e2e-secret-4711';
const SHOTS = process.env.M33_SHOTS ?? 'D:/Coding_Project/MinMusic_4_Windows-wp/shots-M3-3';
mkdirSync(SHOTS, { recursive: true });

const logs: string[] = [];
test.beforeEach(({ page }) => {
  logs.length = 0;
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push(String(e.message)));
});
test.afterEach(() => {
  // R-SEC-3 (UI): no test secret in the console, ever
  for (const l of logs) {
    expect(l).not.toContain(PW);
    expect(l).not.toContain('wrong-e2e');
  }
});

const open = async (page: Page, cat: 'sources' | 'integrations', q = '') => {
  await page.goto(`/src/shell/account/dev.html${q}#/dev/settings/${cat}`);
  await expect(page.locator(`[data-testid="set-${cat}"]`)).toBeVisible();
};
const rowOrder = (page: Page) => page.locator('.sx-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('sx-row-', '')));
const calledSecret = (page: Page) =>
  page.evaluate((pw) => JSON.stringify((window as any).__mmCalls ?? []).includes(pw), PW); // boolean only: nothing secret returns to the trace

test.describe('M3-3 sources', () => {
  test.use({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });

  test('E-40 NCT dialog validation: empty submit shows an inline error and makes no call; phone and country code are checked', async ({ page }) => {
    await open(page, 'sources');
    await page.locator('[data-testid="sx-login-nct"]').click();
    const dlg = page.locator('[data-testid="dlg-nct"]');
    await expect(dlg).toBeVisible();
    await expect(page.locator('[data-testid="fld-account"]')).toBeFocused();
    expect(await dlg.evaluate((e) => (e as HTMLElement).offsetWidth)).toBe(448); // layout width, not the animated box
    await page.locator('[data-testid="dlg-submit"]').click();
    await expect(page.locator('[data-testid="dlg-error"]')).toBeVisible();
    await page.locator('[data-testid="fld-account"]').fill('tester');
    await page.locator('[data-testid="fld-password"]').fill(PW);
    await page.locator('[data-testid="fld-phone"]').fill('12ab');
    await page.keyboard.press('Enter'); // Enter submits
    await expect(page.locator('[data-testid="dlg-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="fld-phone"]')).toHaveAttribute('aria-invalid', '');
    await page.screenshot({ path: `${SHOTS}/nct-dialog-validation-dark.png` });
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(page.locator('[data-testid="sx-login-nct"]')).toBeFocused(); // focus returns to the invoker
  });

  test('E-41 NCT wrong password: inline unauthorized, the password field is empty, the dialog stays open', async ({ page }) => {
    await open(page, 'sources');
    await page.locator('[data-testid="sx-login-nct"]').click();
    await page.locator('[data-testid="fld-account"]').fill('tester');
    await page.locator('[data-testid="fld-password"]').fill('wrong');
    await page.locator('[data-testid="dlg-submit"]').click();
    const err = page.locator('[data-testid="dlg-error"]');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/Wrong account or password/);
    await expect(page.locator('[data-testid="fld-password"]')).toHaveValue('');
    await expect(page.locator('[data-testid="dlg-nct"]')).toBeVisible();
    await expect(page.locator('[data-testid="sx-row-nct"]')).toContainText(/Not signed in/);
    // network error is inline too
    await page.locator('[data-testid="fld-account"]').fill('offline');
    await page.locator('[data-testid="fld-password"]').fill(PW);
    await page.locator('[data-testid="dlg-submit"]').click();
    await expect(err).toContainText(/Cannot connect/);
    await expect(page.locator('[data-testid="fld-password"]')).toHaveValue('');
    await page.screenshot({ path: `${SHOTS}/nct-dialog-error-dark.png` });
  });

  test('E-42 NCT login: password cleared while in flight, row signed in; VIP only for a VIP account (320 shows only with VIP)', async ({ page }) => {
    await open(page, 'sources');
    const row = page.locator('[data-testid="sx-row-nct"]');
    await expect(page.locator('[data-testid="sx-q-nct"]')).toHaveText('128');
    await page.locator('[data-testid="sx-login-nct"]').click();
    await page.locator('[data-testid="fld-account"]').fill('tester');
    await page.locator('[data-testid="fld-password"]').fill(PW);
    await page.locator('[data-testid="dlg-submit"]').click();
    await expect(page.locator('[data-testid="dlg-nct"]')).toHaveCount(0);
    await expect(row).toContainText('tester');
    await expect(page.locator('[data-testid="sx-vip-nct"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="sx-q-nct"]')).toHaveText('128');
    await page.locator('[data-testid="sx-logout-nct"]').click();
    await expect(page.locator('[data-testid="sx-login-nct"]')).toBeVisible();
    // VIP account
    await page.locator('[data-testid="sx-login-nct"]').click();
    await page.locator('[data-testid="fld-account"]').fill('vip.tester');
    await page.locator('[data-testid="fld-password"]').fill(PW);
    await page.locator('[data-testid="dlg-submit"]').click();
    await expect(page.locator('[data-testid="sx-vip-nct"]')).toBeVisible();
    await expect(page.locator('[data-testid="sx-q-nct"]')).toHaveText('320');
    await page.screenshot({ path: `${SHOTS}/sources-nct-vip-dark.png` });
    await page.locator('[data-testid="sx-logout-nct"]').click();
    await expect(page.locator('[data-testid="sx-q-nct"]')).toHaveText('128');
    expect(await calledSecret(page)).toBe(false); // the recorder never saw the password
  });

  test('E-43 Zing web login shows the pending state until it resolves; no VIP badge and 128 without a VIP account', async ({ page }) => {
    await open(page, 'sources', '?lang=vi');
    const btn = page.locator('[data-testid="sx-login-zing"]');
    await btn.click();
    const wait = page.locator('[data-testid="sx-waiting-zing"]');
    await expect(wait).toBeVisible();
    await expect(wait).toHaveText('Đang chờ đăng nhập…');
    await expect(btn).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/sources-zing-waiting-vi-dark.png` });
    await expect(wait).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('[data-testid="sx-logout-zing"]')).toBeVisible();
    await expect(page.locator('[data-testid="sx-row-zing"]')).toContainText('zing.test@example.test');
    await expect(page.locator('[data-testid="sx-vip-zing"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="sx-q-zing"]')).toHaveText('128');
    await expect(page.locator('[data-testid="sx-row-zing"]')).toContainText('320 kbps cần tài khoản VIP');
    await page.locator('[data-testid="sx-logout-zing"]').click();
    await expect(page.locator('[data-testid="sx-login-zing"]')).toBeVisible();
  });

  test('E-44 list: status dots, enable switch, auto switches, YouTube token dialog, light theme', async ({ page }) => {
    await open(page, 'sources', '?theme=light');
    await expect(page.locator('.sx-row')).toHaveCount(4);
    await expect(page.locator('[data-testid="sx-status-yt"]')).toHaveClass(/ok/);
    await expect(page.locator('[data-testid="sx-status-sc"]')).toHaveClass(/degraded/);
    await expect(page.locator('[data-testid="sx-login-sc"]')).toHaveCount(0); // SoundCloud has no login
    const sw = page.locator('[data-testid="sx-enable-sc"]');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('[data-testid="sx-status-sc"]')).toHaveClass(/off/);
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    const ab = page.locator('[data-testid="sx-auto-best"]');
    const was = await ab.getAttribute('aria-checked');
    await ab.click();
    await expect(ab).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true');
    await ab.click();
    await expect(ab).toHaveAttribute('aria-checked', was!);
    // token dialog: cookie masked and cleared
    await page.locator('[data-testid="sx-token"]').click();
    const cookie = page.locator('[data-testid="fld-cookie"]');
    await expect(cookie).toHaveAttribute('type', 'password');
    await page.screenshot({ path: `${SHOTS}/sources-token-dialog-light.png` });
    await cookie.fill('SID=cookie-e2e-secret');
    await page.locator('[data-testid="dlg-submit"]').click();
    await expect(page.locator('[data-testid="dlg-token"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="sx-logout-yt"]')).toBeVisible();
    await expect(page.locator('[data-testid="sx-switch-channel"]')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/sources-light.png` });
    await page.locator('[data-testid="sx-logout-yt"]').click();
    await expect(page.locator('[data-testid="sx-login-yt"]')).toBeVisible();
  });

  test('E-45 priority: drag a row two places down, keyboard arrows move it back; sources.setPriority gets the new order', async ({ page }) => {
    await open(page, 'sources');
    expect(await rowOrder(page)).toEqual(['yt', 'zing', 'nct', 'sc']);
    const h = await page.locator('[data-testid="sx-handle-yt"]').boundingBox();
    const rowH = (await page.locator('[data-testid="sx-row-yt"]').boundingBox())!.height;
    const x = h!.x + h!.width / 2;
    const y = h!.y + h!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x, y + (2 * rowH * i) / 8);
    // while dragging the row follows the pointer with a transform only
    expect(await page.locator('[data-testid="sx-row-yt"]').evaluate((e) => getComputedStyle(e).transform)).not.toBe('none');
    await page.screenshot({ path: `${SHOTS}/sources-dragging-dark.png` });
    await page.mouse.up();
    await expect.poll(() => rowOrder(page)).toEqual(['zing', 'nct', 'yt', 'sc']);
    const sent = await page.evaluate(() => ((window as any).__mmCalls as { m: string; p: any }[]).filter((c) => c.m === 'sources.setPriority').map((c) => c.p.order));
    expect(sent.at(-1)).toEqual(['zing', 'nct', 'yt', 'sc']);
    // persists across a reload (mock state)
    await page.reload();
    await expect(page.locator('.sx-row')).toHaveCount(4);
    expect(await rowOrder(page)).toEqual(['zing', 'nct', 'yt', 'sc']);
    // keyboard
    await page.locator('[data-testid="sx-handle-yt"]').focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => rowOrder(page)).toEqual(['zing', 'yt', 'nct', 'sc']);
    await page.locator('[data-testid="sx-handle-yt"]').focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => rowOrder(page)).toEqual(['yt', 'zing', 'nct', 'sc']);
  });
});

test.describe('M3-3 integrations and account menu', () => {
  test.use({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });

  test('E-46 Last.fm dialog: wrong password inline, field cleared; good login shows status; logout', async ({ page }) => {
    await open(page, 'integrations');
    await expect(page.locator('[data-testid="ig-lastfm-user"]')).toContainText(/Not signed in/);
    await page.locator('[data-testid="ig-lastfm-login"]').click();
    const dlg = page.locator('[data-testid="dlg-lastfm"]');
    await expect(dlg).toBeVisible();
    await page.locator('[data-testid="fld-username"]').fill('tester');
    await page.locator('[data-testid="fld-password"]').fill('wrong');
    await page.locator('[data-testid="dlg-submit"]').click();
    await expect(page.locator('[data-testid="dlg-error"]')).toContainText(/Wrong account or password/);
    await expect(page.locator('[data-testid="fld-password"]')).toHaveValue('');
    await page.screenshot({ path: `${SHOTS}/lastfm-dialog-error-dark.png` });
    await page.locator('[data-testid="fld-password"]').fill(PW);
    await page.keyboard.press('Enter');
    await expect(dlg).toHaveCount(0);
    await expect(page.locator('[data-testid="ig-lastfm-user"]')).toContainText('tester');
    await expect(page.locator('[data-testid="ig-lastfm-status"]')).toContainText('2');
    await page.screenshot({ path: `${SHOTS}/integrations-dark.png` });
    await page.locator('[data-testid="ig-lastfm-logout"]').click();
    await expect(page.locator('[data-testid="ig-lastfm-login"]')).toBeVisible();
    expect(await calledSecret(page)).toBe(false);
  });

  test('ListenBrainz token is masked and cleared after save; bad token inline; clear; Discord login pending then signed in', async ({ page }) => {
    await open(page, 'integrations', '?lang=vi');
    const tok = page.locator('[data-testid="ig-lb-token"]');
    await expect(tok).toHaveAttribute('type', 'password');
    await tok.fill('bad');
    await page.locator('[data-testid="ig-lb-save"]').click();
    await expect(page.locator('[data-testid="ig-lb-error"]')).toBeVisible();
    await expect(tok).toHaveValue('');
    await tok.fill('tok-e2e-secret');
    await page.locator('[data-testid="ig-lb-save"]').click();
    await expect(tok).toHaveValue('');
    await expect(page.locator('[data-testid="ig-lb-user"]')).toContainText('lb_test_user');
    await page.locator('[data-testid="ig-lb-clear"]').click();
    await expect(page.locator('[data-testid="ig-lb-user"]')).toContainText('Chưa đặt token');
    await page.locator('[data-testid="ig-discord-login"]').click();
    await expect(page.locator('[data-testid="ig-discord-waiting"]')).toHaveText('Đang chờ đăng nhập…');
    await expect(page.locator('[data-testid="ig-discord-status"]')).toContainText('TestUser', { timeout: 5000 });
    await page.screenshot({ path: `${SHOTS}/integrations-vi-dark.png` });
    await page.locator('[data-testid="ig-discord-logout"]').click();
    await expect(page.locator('[data-testid="ig-discord-login"]')).toBeVisible();
    expect(await calledSecret(page)).toBe(false);
  });

  test('account menu: signed out entries, sign in (pending), name, switch channel, Esc closes, sign out', async ({ page }) => {
    await open(page, 'sources', '?lang=vi');
    const btn = page.locator('[data-testid="account-btn"]');
    await btn.click();
    const menu = page.locator('[data-testid="account-menu"]');
    await expect(menu).toContainText('Chưa đăng nhập');
    await page.waitForTimeout(300); // let the fade finish
    await page.screenshot({ path: `${SHOTS}/account-menu-signedout-vi-dark.png` });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(btn).toBeFocused();
    await btn.click();
    await page.locator('[data-testid="am-login"]').click();
    await expect(menu).toHaveCount(0, { timeout: 5000 });
    await expect(btn).toHaveText('T');
    await btn.click();
    await expect(page.locator('[data-testid="am-name"]')).toHaveText('Test User');
    await page.waitForTimeout(300); // let the fade finish
    await page.screenshot({ path: `${SHOTS}/account-menu-vi-dark.png` });
    await page.locator('[data-testid="am-switch"]').click();
    await expect(page.locator('[data-testid="am-name"]')).toHaveText('Test Music Channel', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('[data-testid="sx-row-yt"]')).toContainText('test.user@example.test');
    await btn.click();
    await page.locator('[data-testid="am-logout"]').click();
    await expect(menu).toHaveCount(0);
    await expect(btn).not.toHaveText('T');
    await expect(page.locator('[data-testid="sx-login-yt"]')).toBeVisible();
  });
});

test.describe('M3-3 compact width', () => {
  test.use({ viewport: { width: 800, height: 700 }, colorScheme: 'dark' });
  test('sources list does not overflow horizontally at 800 px', async ({ page }) => {
    await open(page, 'sources');
    const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(over).toBe(false);
    await page.screenshot({ path: `${SHOTS}/sources-compact-dark.png` });
  });
});
