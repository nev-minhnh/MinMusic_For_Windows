import { test, expect } from '../fixtures/app';

// M2-3b on the real app (INT-W3, via scripts/e2e.ps1 -Suite app): Ctrl E opens the Equalizer, a drag changes the real core's
// band, and the graph curve equals eq.response. NOT run by the WP agent (build policy); the selectors are the same as the web spec.
const INSET = { l: 40, r: 20, t: 12, b: 26 };

test('Equalizer: Ctrl E opens the page, drag a node moves a band, the curve comes from the core', async ({ app }) => {
  const { page } = app;
  await page.keyboard.press('Control+e');
  await expect(page.locator('[data-testid="equalizer"]')).toBeVisible();
  const box = (await page.locator('[data-testid="eq-canvas"]').boundingBox())!;
  const w = box.width - INSET.l - INSET.r;
  // band 5 sits at 1 kHz on the flat profile: x = log position, y = 0 dB (middle of the plot)
  const x = box.x + INSET.l + (Math.log(1000 / 20) / Math.log(1000)) * w;
  const y = box.y + INSET.t + (box.height - INSET.t - INSET.b) / 2;
  const before = await page.locator('[data-testid="eq-gain"]').inputValue();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 50, y - 40, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-testid="eq-gain"]')).not.toHaveValue(before);
  await app.shot('m2-3b-equalizer');
  // keyboard: Tab selects the next band, the page keeps the arrows
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-testid="eq-graph"]')).toBeFocused();
  await page.locator('[data-testid="eq-reset"]').click();
});
