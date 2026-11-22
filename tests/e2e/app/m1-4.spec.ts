import { test, expect } from '../fixtures/app';

// `scripts/e2e.ps1 -Suite app -Spec tests/e2e/app/m1-4.spec.ts` (integration run, INT-W1).

test('m1-4: shell_settings_set/get round-trip, private keys stay private', async ({ app }) => {
  await app.invoke('shell_settings_set', { patch: { sidebarWidth: 248, paneWidth: 336, window: { x: 1 } } });
  const got = await app.invoke<Record<string, unknown>>('shell_settings_get');
  expect(got.sidebarWidth).toBe(248);
  expect(got.paneWidth).toBe(336);
  expect(got.window).toBeUndefined();
  // null removes a key
  await app.invoke('shell_settings_set', { patch: { paneWidth: null } });
  const again = await app.invoke<Record<string, unknown>>('shell_settings_get');
  expect(again.paneWidth).toBeUndefined();
  expect(again.sidebarWidth).toBe(248);
});

test('m1-4: caption_rects is accepted', async ({ app }) => {
  await app.invoke('caption_rects', { max: [1000, 0, 46, 40] });
  await app.invoke('caption_rects', { max: [0, 0, 0, 0] });
});

// A second launch with a deep link is done by scripts (T-P4 style) through MM_SECOND_URL: the runner starts
// `MinMusic.exe minmusic://album/<id>` with the same MINMUSIC_DATA_ROOT; this test listens for `mm-nav`.
test('m1-4: mm-nav arrives after a second-instance launch with minmusic://album/<id>', async ({ app }) => {
  const url = process.env.MM_SECOND_URL; // e.g. minmusic://album/MPREb_fixture
  test.skip(!url, 'MM_SECOND_URL not set by the runner');
  await app.page.evaluate(() => {
    (window as any).__mmNav = [];
    (window as any).__TAURI__.event.listen('mm-nav', (e: any) => (window as any).__mmNav.push(e.payload));
  });
  const { spawnSync } = await import('node:child_process');
  const exe = process.env.MM_APP_EXE;
  test.skip(!exe, 'MM_APP_EXE not set by the runner');
  spawnSync(exe!, [url!], { timeout: 5000 });
  await expect
    .poll(async () => app.page.evaluate(() => (window as any).__mmNav.length), { timeout: 8000 })
    .toBeGreaterThan(0);
  const nav = await app.page.evaluate(() => (window as any).__mmNav[0]);
  expect(nav.route).toBe('album');
});
