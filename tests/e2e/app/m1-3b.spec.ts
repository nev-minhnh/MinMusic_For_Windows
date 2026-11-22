import { test, expect } from '../fixtures/app';

// App project (WebView2 over CDP, run by integration on the real core with the fixture Home + live search).
// E-1: Home paints the quick picks, the charts box and shelves. E-6: Ctrl K, suggestions (<= 8), Enter, results, Esc in 3 steps.
test('app E-1: Home quick picks, charts box and shelves', async ({ app }) => {
  const p = app.page;
  await expect(p.locator('[data-testid="home"]')).toBeVisible();
  await expect(p.locator('[data-testid="qp-tile"]').first()).toBeVisible();
  await expect(p.locator('[data-testid="chart-row"]')).toHaveCount(10);
  await expect(p.locator('[data-testid="shelf-section"]').first()).toBeVisible();
  await app.shot('m1-3b-home');
});

test('app E-6: Ctrl K, suggestions, Enter, results, Esc x3', async ({ app }) => {
  const p = app.page;
  const input = p.locator('[data-testid="search-input"]');
  await p.keyboard.press('Control+k');
  await expect(input).toBeFocused();
  await input.pressSequentially('son');
  await expect(p.locator('[data-testid="suggest-row"]').first()).toBeVisible();
  expect(await p.locator('[data-testid="suggest-row"]').count()).toBeLessThanOrEqual(8);
  await input.press('Enter');
  await expect(p.locator('[data-testid="search-page"]')).toBeVisible();
  await app.shot('m1-3b-search');
  await p.keyboard.press('Escape');
  await expect(input).toHaveValue('');
  await p.keyboard.press('Escape');
  await expect(input).not.toBeFocused();
  await p.keyboard.press('Escape');
  await expect(p.locator('[data-testid="home"]')).toBeVisible();
});
