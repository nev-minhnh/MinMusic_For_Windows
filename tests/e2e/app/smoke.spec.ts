import { test, expect } from '../fixtures/app';

// `scripts/e2e.ps1 -Suite app` : attached to the real app. Home paints, core is ready, screenshot via CDP.
test('app: core ready, Home visible, CDP screenshot', async ({ app }) => {
  const st = await app.invoke<{ state: string }>('core_status');
  expect(JSON.stringify(st)).toContain('ready');
  // Specs share one app instance; earlier ones leave a dev route or a deep-linked page open.
  await app.page.evaluate(() => { location.hash = ''; window.dispatchEvent(new CustomEvent('mm-nav', { detail: { route: 'home' } })); });
  await expect(app.page.locator('[data-testid="home"]').last()).toBeVisible();
  const f = await app.shot('smoke-home');
  expect(f).toMatch(/smoke-home\.png$/);
});
