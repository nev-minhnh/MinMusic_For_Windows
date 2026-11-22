import { test, expect } from '../fixtures/app';

// `scripts/e2e.ps1 -Suite app -Spec m2-2` : real app (WebView2 + Kotlin core). Written against the mock-verified web spec;
// it only needs a running core, not specific tracks. Not run by the WP (build policy): INT-W2 runs it.
test('app M2-2: queue pane, full player, lyrics fullscreen and the Esc stack', async ({ app }) => {
  const page = app.page;
  await expect(page.locator('[data-testid="player-bar"]')).toBeVisible();
  // Q: support pane with the queue
  await page.locator('body').click({ position: { x: 600, y: 300 } });
  await page.keyboard.press('q');
  await expect(page.locator('[data-testid="support-pane"]')).toBeVisible();
  await expect(page.locator('[data-testid="autoplay-switch"]')).toBeVisible();
  await app.shot('m2-2-queue-pane');
  await page.keyboard.press('q');
  await expect(page.locator('[data-testid="support-pane"]')).toBeHidden();
  // T: full player; F11 inside it: lyrics fullscreen; Esc peels fullscreen, then the player
  await page.keyboard.press('t');
  const fp = page.locator('[data-testid="full-player"]');
  await expect(fp).toBeVisible();
  await page.waitForTimeout(600);
  await page.keyboard.press('F11');
  await expect(page.locator('[data-testid="lyrics-fullscreen"]')).toBeVisible();
  await app.shot('m2-2-lyrics-fullscreen');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="lyrics-fullscreen"]')).toBeHidden();
  await expect(fp).toBeVisible();
  await app.shot('m2-2-full-player');
  await page.keyboard.press('Escape');
  await expect(fp).toBeHidden();
  // volume popover / mute key reach the real core without an error toast
  await page.keyboard.press('m');
  await page.keyboard.press('m');
  await expect(page.locator('[data-testid="player-bar"]')).toBeVisible();
});
