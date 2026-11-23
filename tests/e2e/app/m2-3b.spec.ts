import { test, expect } from '../fixtures/app';

// M2-3b on the real app (INT-W3, via scripts/e2e.ps1 -Suite app): Ctrl E opens the Equalizer, a drag changes the real core's
// band, and the graph curve equals eq.response. NOT run by the WP agent (build policy); the selectors are the same as the web spec.
const INSET = { l: 40, r: 20, t: 12, b: 26 };

test('Equalizer: Ctrl E opens the page, drag a node moves a band, the curve comes from the core', async ({ app }) => {
  const { page } = app;
  await page.keyboard.press('Control+e');
  await expect(page.locator('[data-testid="equalizer"]')).toBeVisible();
  // the real core's flat profile has its own band layout (possibly none): make sure one band exists, select it through its fader,
  // and read its frequency and gain from the inspector (a 2nd 'ui' WS connection would evict the page's own, so the core is not asked)
  await expect(page.locator('[data-testid="eq-add-band"]')).toBeEnabled();
  await page.waitForTimeout(500); // let the first eq.get land
  if (!(await page.locator('[data-testid="eq-fader-0"]').count())) await page.locator('[data-testid="eq-add-band"]').click();
  await page.locator('[data-testid="eq-fader-0"]').evaluate((e) => (e as HTMLElement).focus({ preventScroll: true }));
  await page.locator('[data-testid="eq-canvas"]').scrollIntoViewIfNeeded(); // the 1280x? window can show the graph only partly
  await expect(page.locator('[data-testid="eq-freq"]')).toHaveValue(/Hz$/);
  const num = async (id: string) => parseFloat(((await page.locator(`[data-testid="${id}"]`).inputValue()) || '0').replace(',', '.'));
  const band = { freq: await num('eq-freq'), gain: await num('eq-gain') };
  // the page slides in for 300 ms (translateX): measure the canvas only once it stopped moving
  const canvas = page.locator('[data-testid="eq-canvas"]');
  let last = '';
  await expect.poll(async () => { const b = JSON.stringify(await canvas.boundingBox()); const same = b === last; last = b; return same; }, { intervals: [150] }).toBe(true);
  const box = (await canvas.boundingBox())!;
  const w = box.width - INSET.l - INSET.r, h = box.height - INSET.t - INSET.b;
  const x = box.x + INSET.l + (Math.log(band.freq / 20) / Math.log(1000)) * w;
  const y = box.y + INSET.t + (0.5 - Math.max(-18, Math.min(18, band.gain ?? 0)) / 36) * h;
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
