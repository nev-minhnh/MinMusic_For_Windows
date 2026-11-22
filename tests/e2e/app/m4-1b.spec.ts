import { test, expect } from '../fixtures/app';

// App project (integration only, not run by the WP): Settings against the real core and shell.
test('app: Ctrl+, opens Settings, Appearance rows render from the real settings.schema, theme switch is live', async ({ app }) => {
  const { page } = app;
  await page.keyboard.press('Control+,');
  await expect(page.locator('[data-testid="settings"]:visible')).toBeVisible();
  await page.locator('[data-testid="set-cat-Appearance"]').click();
  await expect(page.locator('[data-testid="set-row"]').first()).toBeVisible();
  await page.locator('[data-setting="themeMode"]').getByRole('tab', { name: /Pure black|Đen/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'black');
  await page.locator('[data-setting="themeMode"]').getByRole('tab', { name: /Dark|Tối/ }).click();
  await app.shot('m4-1b-appearance');
});

test('app: About shows the core version and the core state from core_status', async ({ app }) => {
  const { page } = app;
  await page.keyboard.press('Control+,');
  await page.locator('[data-testid="set-cat-About"]').click();
  await expect(page.locator('[data-testid="about-version"]')).toHaveText(/\d+\.\d+/);
  await expect(page.locator('[data-testid="about-core-state"]')).toHaveText(/Ready|Sẵn sàng/);
  await app.shot('m4-1b-about');
});
