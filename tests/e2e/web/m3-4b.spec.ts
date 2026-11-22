import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// E-44 (Device Connect QR equals dc.state.link), the SAS approval flow, Listen Together create/join flows (M3-4b), on the `web` project (Vite + mock-core).
// Ports 5193 / 48013 (waves.md): MM_WEB_PORT=5193 MOCK_PORT=48013.
const ROOT = path.resolve(__dirname, '../../..');
const require = createRequire(__filename);
const qrcode = require(path.join(ROOT, 'node_modules/qrcode-generator'));
const shots = path.join(ROOT, '.testdata', 'm3-4b', 'shots');
fs.mkdirSync(shots, { recursive: true });
const MOCK_PORT = Number(process.env.MOCK_PORT) || 47999;

test.use({ viewport: { width: 1440, height: 900 } });

/** A second, raw connection to the mock for state resets and the mock-only hooks (incoming request, join request, suggestion). */
async function core() {
  // @ts-ignore .mjs without types
  const { Conn } = await import('../../contract/lib/conn.mjs');
  const c = await Conn.connect({ port: MOCK_PORT, token: 'dev' }, { origin: `http://127.0.0.1:${process.env.MM_WEB_PORT || 5173}` });
  return {
    call: (m: string, p?: unknown) => c.raw(m, p, { validate: false }).then((r: any) => r.r),
    close: () => c.close(),
  };
}
let admin: Awaited<ReturnType<typeof core>>;
test.beforeAll(async () => { admin = await core(); });
test.afterAll(() => admin.close());
test.beforeEach(async () => {
  await admin.call('dc.enable', { on: false });
  await admin.call('lt.leave');
});

const calls = (page: Page, m: string) => page.evaluate((method) => ((window as any).__mmCalls as { m: string; p: any }[]).filter((c) => c.m === method), m);
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(shots, `${name}.png`) });

async function boot(page: Page) {
  await page.goto('/');
  await expect(page.locator('[data-testid="home"]')).toBeVisible();
}
async function openPanel(page: Page) {
  await page.keyboard.press('d');
  const panel = page.locator('[data-testid="dc-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-testid="dc-enable"]')).toBeVisible();
  return panel;
}
async function openLt(page: Page) {
  await page.keyboard.press('Control+,');
  const shell = page.locator('[data-testid="settings"]:visible');
  await shell.locator('[data-testid="set-cat-deviceConnect"]').click();
  await shell.locator('[data-testid="dcs-open-lt"]').click();
  const lt = page.locator('[data-testid="listen-together"]:visible');
  await expect(lt).toBeVisible();
  return lt;
}

test.describe('E-44 Device Connect panel', () => {
  test('D opens the panel, Esc closes it, the QR encodes dc.state.link', async ({ page }) => {
    await boot(page);
    const panel = await openPanel(page);
    await expect(panel.locator('[data-testid="dc-qr"]')).toHaveCount(0); // disabled: no QR
    await panel.locator('[data-testid="dc-enable"]').click();
    const qr = panel.locator('[data-testid="dc-qr"]');
    await expect(qr).toBeVisible();

    const link = await panel.locator('[data-testid="dc-link"]').innerText();
    expect(link).toMatch(/^metrolist:\/\/device-connect\?a=[^&]+&n=.+$/);
    expect(await qr.getAttribute('data-link')).toBe(link);

    // the rendered QR is exactly the level-M matrix of that link (byte-identical encoder, architecture 8)
    const q = qrcode(0, 'M');
    q.addData(link);
    q.make();
    const n = q.getModuleCount();
    const dark: string[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) dark.push(`M${c + 4} ${r + 4}h1v1h-1z`);
    const d = await qr.locator('svg path').getAttribute('d');
    expect(d).toBe(dark.join(''));
    expect(await qr.locator('svg').getAttribute('viewBox')).toBe(`0 0 ${n + 8} ${n + 8}`);
    expect(await qr.locator('script, foreignObject, [onload], [onclick]').count()).toBe(0);

    // addresses (ip:port) are the ones in the link
    const a = new URL(link).searchParams.get('a')!.split(',');
    const shown = await panel.locator('[data-testid="dc-addresses"] li').allInnerTexts();
    expect(shown).toEqual(a);
    await shot(page, 'e44-panel-enabled');

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('firewall hint opens the Windows firewall settings; port change updates the link', async ({ page }) => {
    await boot(page);
    const panel = await openPanel(page);
    await panel.locator('[data-testid="dc-enable"]').click();
    await expect(panel.locator('[data-testid="dc-firewall"]')).toHaveAttribute('data-state', 'no_rule');
    await panel.locator('[data-testid="dc-firewall-open"]').click();
    await expect.poll(async () => (await calls(page, 'dc.openFirewallSettings')).length).toBe(1);

    const port = panel.locator('[data-testid="dc-port"]');
    await port.fill('80'); // out of range: reverts, nothing sent
    await port.press('Enter');
    await expect(port).toHaveValue('48765');
    expect(await calls(page, 'dc.setPort')).toHaveLength(0);
    await port.fill('48999');
    await port.press('Enter');
    await expect(panel.locator('[data-testid="dc-link"]')).toContainText(':48999');
  });

  test('incoming request: SAS card, confirm pairs the device; mismatch drops it', async ({ page }) => {
    await boot(page);
    // a request arrives while the panel is closed: the panel opens by itself
    await admin.call('mock.dc.incoming', { peer: 'Redmi Note 13' });
    const panel = page.locator('[data-testid="dc-panel"]');
    await expect(panel).toBeVisible();
    const card = panel.locator('[data-testid="dc-request"]');
    await expect(card).toContainText('Redmi Note 13');
    await expect(card.locator('[data-testid="dc-sas"]')).toHaveText(/^\d{3} \d{3}$/);
    await shot(page, 'e44-sas-request');
    await card.locator('[data-testid="dc-confirm"]').click();
    await expect(card).toHaveCount(0);
    expect((await calls(page, 'dc.confirmSas'))[0].p.match).toBe(true);
    expect(await calls(page, 'dc.accept')).toHaveLength(1);
    const dev = panel.locator('[data-testid="dc-device"]', { hasText: 'Redmi Note 13' });
    await expect(dev).toBeVisible();
    await expect(dev).toContainText(/Paired|Đã ghép/);

    await admin.call('mock.dc.incoming', { peer: 'Impostor' });
    const card2 = panel.locator('[data-testid="dc-request"]');
    await expect(card2).toContainText('Impostor');
    await card2.locator('[data-testid="dc-reject"]').click();
    await expect(card2).toHaveCount(0);
    expect((await calls(page, 'dc.confirmSas')).pop()!.p.match).toBe(false);
    await expect(panel.locator('[data-testid="dc-device"]', { hasText: 'Impostor' })).toHaveCount(0);
  });

  test('connect by link shows the request (never auto-connects); bad links are refused inline', async ({ page }) => {
    await boot(page);
    const panel = await openPanel(page);
    const devices = await panel.locator('[data-testid="dc-device"]').count();
    const input = panel.locator('[data-testid="dc-link-input"]');
    await input.fill('https://example.com/x');
    await input.press('Enter');
    await expect(panel.locator('[data-testid="dc-link-err"]')).toBeVisible();
    await input.fill('metrolist://device-connect?a=192.168.1.50:48765&n=Phone%20B');
    await expect(panel.locator('[data-testid="dc-link-err"]')).toHaveCount(0);
    await input.press('Enter');
    const card = panel.locator('[data-testid="dc-request"]');
    await expect(card).toContainText('Phone B');
    await expect(panel.locator('[data-testid="dc-device"]')).toHaveCount(devices); // not connected yet
    expect(await calls(page, 'dc.accept')).toHaveLength(0);
    await expect(input).toHaveValue('');
  });

  test('devices: attach / release, transfer, forget with confirmation', async ({ page }) => {
    await boot(page);
    const panel = await openPanel(page);
    const pixel = panel.locator('[data-testid="dc-device"][data-device="dev-pixel"]');
    const tab = panel.locator('[data-testid="dc-device"][data-device="dev-tab"]');
    await expect(pixel).toHaveAttribute('data-online', 'true');
    await expect(tab.locator('[data-testid="dc-transfer"]')).toHaveCount(0); // offline devices cannot be controlled
    await pixel.locator('[data-testid="dc-attach"]').click();
    await expect(pixel).toHaveAttribute('data-session', 'true');
    await pixel.locator('[data-testid="dc-release"]').click();
    await expect(pixel).toHaveAttribute('data-session', 'false');
    await pixel.locator('[data-testid="dc-transfer"]').click();
    await expect(pixel).toHaveAttribute('data-session', 'true');
    expect((await calls(page, 'dc.transferTo'))[0].p).toEqual({ deviceId: 'dev-pixel' });
    await shot(page, 'e44-devices');

    await tab.locator('[data-testid="dc-forget"]').click();
    await page.locator('[data-testid="confirm-dialog"]').getByTestId('confirm-ok').click();
    await expect(tab).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('Settings > Device Connect page mirrors the switch and links the panel and the LT page', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('Control+,');
    const shell = page.locator('[data-testid="settings"]:visible');
    await shell.locator('[data-testid="set-cat-deviceConnect"]').click();
    const sw = shell.locator('[data-testid="dcs-enable"]');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(shell.locator('[data-setting="dc.port"]')).toBeVisible();
    await expect(shell.locator('[data-setting="listenTogetherUsername"]')).toBeVisible();
    await shot(page, 'settings-deviceconnect');
    await shell.locator('[data-testid="dcs-open-panel"]').click();
    await expect(page.locator('[data-testid="dc-panel"] [data-testid="dc-qr"]')).toBeVisible();
  });
});

test.describe('Listen Together page', () => {
  test('create: host view, join request toast + approve, suggestion approve, kick -> blocked -> unblock, close room', async ({ page }) => {
    await boot(page);
    const lt = await openLt(page);
    await expect(lt.locator('[data-testid="lt-idle"]')).toBeVisible();
    await shot(page, 'lt-idle');
    await lt.locator('[data-testid="lt-name"]').fill('Minh');
    await lt.locator('[data-testid="lt-create"]').click();
    await expect(lt).toHaveAttribute('data-status', 'host');
    await expect(lt.locator('[data-testid="lt-code"]')).toHaveText('K7QX2M');
    await expect(lt.locator('[data-testid="lt-user"]')).toHaveCount(1);

    // join request: toast with an action AND a row in the pending list
    await admin.call('mock.lt.joinRequest', { name: 'Hùng' });
    const toast = page.locator('[data-testid="toast"]');
    await expect(toast).toContainText('Hùng');
    await expect(lt.locator('[data-testid="lt-pending-user"]')).toHaveCount(1);
    await toast.getByRole('button').click(); // Approve (toast action)
    await expect(lt.locator('[data-testid="lt-pending-user"]')).toHaveCount(0);
    await expect(lt.locator('[data-testid="lt-user"]')).toHaveCount(2);

    // a second request rejected from the list
    await admin.call('mock.lt.joinRequest', { name: 'Mai' });
    await lt.locator('[data-testid="lt-pending-user"] [data-testid="lt-reject"]').click();
    await expect(lt.locator('[data-testid="lt-pending-user"]')).toHaveCount(0);

    // suggestion
    await admin.call('mock.lt.suggestion', { by: 'Hùng' });
    const sg = lt.locator('[data-testid="lt-suggestion"]');
    await expect(sg).toHaveCount(1);
    await shot(page, 'lt-host');
    await sg.locator('[data-testid="lt-sg-approve"]').click();
    await expect(sg).toHaveCount(0);
    expect(await calls(page, 'lt.suggestion.approve')).toHaveLength(1);

    // invite link
    await lt.locator('[data-testid="lt-invite"]').click();
    await expect(lt.locator('[data-testid="lt-invite-url"]')).toContainText('K7QX2M');

    // kick -> blocked list -> unblock
    await lt.locator('[data-testid="lt-user"][data-host="false"] [data-testid="lt-kick"]').click();
    await expect(lt.locator('[data-testid="lt-user"]')).toHaveCount(1);
    await expect(lt.locator('[data-testid="lt-blocked-user"]')).toHaveCount(1);
    await lt.locator('[data-testid="lt-unblock"]').click();
    await expect(lt.locator('[data-testid="lt-blocked-user"]')).toHaveCount(0);

    await lt.locator('[data-testid="lt-leave"]').click();
    await expect(lt.locator('[data-testid="lt-idle"]')).toBeVisible();
  });

  test('join: validation, unknown room, guest view with suggest, leave', async ({ page }) => {
    await boot(page);
    // something is playing, so the guest can suggest it
    await admin.call('player.play', { context: { kind: 'library', list: 'songs', sort: { by: 'added', desc: true } }, startIndex: 0 });
    const lt = await openLt(page);
    await lt.locator('[data-testid="lt-name"]').fill('Minh');
    const join = lt.locator('[data-testid="lt-join"]');
    await expect(join).toHaveClass(/dis/); // no code yet
    await lt.locator('[data-testid="lt-code-input"]').fill('abc');
    await join.click();
    await expect(lt.locator('[data-testid="lt-error"]')).toBeVisible(); // bad_request: not 6 chars
    await lt.locator('[data-testid="lt-code-input"]').fill('noroom');
    await expect(lt.locator('[data-testid="lt-code-input"]')).toHaveValue('NOROOM');
    await join.click();
    await expect(lt.locator('[data-testid="lt-error"]')).toBeVisible();
    await shot(page, 'lt-join-error');

    await lt.locator('[data-testid="lt-code-input"]').fill('abc123');
    await lt.locator('[data-testid="lt-code-input"]').press('Enter');
    await expect(lt).toHaveAttribute('data-status', 'guest');
    await expect(lt.locator('[data-testid="lt-code"]')).toHaveText('ABC123');
    await expect(lt.locator('[data-testid="lt-user"][data-host="true"]')).toContainText('Lan');
    await expect(lt.locator('[data-testid="lt-kick"]')).toHaveCount(0); // guests cannot moderate
    await expect(lt.locator('[data-testid="lt-suggest"]')).not.toHaveClass(/dis/);
    await lt.locator('[data-testid="lt-suggest"]').click();
    await expect.poll(async () => (await calls(page, 'lt.suggest')).length).toBe(1);
    await shot(page, 'lt-guest');
    await lt.locator('[data-testid="lt-leave"]').click();
    await expect(lt.locator('[data-testid="lt-idle"]')).toBeVisible();
  });

  test('server picker calls lt.setServer', async ({ page }) => {
    await boot(page);
    const lt = await openLt(page);
    const sel = lt.locator('[data-testid="lt-server"]');
    await expect(sel.locator('option')).toHaveCount(2);
    await sel.selectOption({ index: 1 });
    await expect.poll(async () => (await calls(page, 'lt.setServer')).length).toBe(1);
    await expect(sel).toHaveValue('wss://lt-backup.mock.example/ws');
    await sel.selectOption({ index: 0 });
  });
});
