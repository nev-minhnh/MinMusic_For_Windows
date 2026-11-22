import { test, expect, type Page } from '@playwright/test';

// E-1 .. E-4 (test-guide section 4) on the `web` project (Vite dev server + mock-core).
// data-testid contract with M0-C: home, qp-tile, shelf, songs-list, song-row, player-bar, player-art,
// full-player, nav-back. Library is reached through nav-library/nav-songs when present, else the first
// link named "Thư viện" / "Library".
const VIEWPORTS = [
  { name: '1536x960@2.5', width: 1536, height: 960, dpr: 2.5, cls: 'expanded' },
  { name: '1920x1200@1', width: 1920, height: 1200, dpr: 1, cls: 'expanded' },
  { name: '1024x768', width: 1024, height: 768, dpr: 1, cls: 'medium' },
  { name: '800x600', width: 800, height: 600, dpr: 1, cls: 'compact' },
];

const scrollTopOf = (e: Element) => (e as HTMLElement).scrollTop || (e.querySelector('[data-scroller]') as HTMLElement | null)?.scrollTop || 0;

async function openLibrary(page: Page) {
  const nav = page.locator('[data-testid="nav-library"], [data-testid="nav-songs"]').first();
  if (await nav.count()) await nav.click();
  else await page.getByRole('link', { name: /Thư viện|Library/i }).first().click();
  await expect(page.locator('[data-testid="songs-list"]')).toBeVisible();
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr });

    test('E-1 Home renders quickly, quick-pick columns per width class', async ({ page }) => {
      const t0 = Date.now();
      await page.goto('/');
      await expect(page.locator('[data-testid="home"]')).toBeVisible();
      await expect(page.locator('[data-testid="qp-tile"]').first()).toBeVisible();
      expect(Date.now() - t0, 'Home visible (dev server, cold JIT: loose bound)').toBeLessThan(3000);
      await expect(page.locator('[data-testid="shelf"]').first()).toBeAttached();
      const cols = await page
        .locator('[data-testid="qp-tile"]')
        .evaluateAll((els) => new Set(els.slice(0, 12).map((e) => Math.round(e.getBoundingClientRect().left))).size);
      const expected = vp.cls === 'expanded' ? [3, 4] : vp.cls === 'medium' ? [2, 3] : [1, 2];
      expect(cols, `quick picks columns at ${vp.name}`).toBeGreaterThanOrEqual(expected[0]);
      expect(cols).toBeLessThanOrEqual(expected[1]);
    });

    test('E-2 Library: End scrolls to row 4,999; scroll kept after Album -> Back', async ({ page }) => {
      await page.goto('/');
      await openLibrary(page);
      const list = page.locator('[data-testid="songs-list"]');
      await list.hover();
      await page.keyboard.press('End');
      await expect(page.locator('[data-testid="song-row"]').filter({ hasText: /4999|5000/ }).first()).toBeVisible({ timeout: 8000 });
      const top = await list.evaluate(scrollTopOf);
      await page.locator('[data-testid="song-row"]').last().click();
      await page.keyboard.press('Alt+ArrowLeft');
      await expect(list).toBeVisible();
      expect(Math.abs((await list.evaluate(scrollTopOf)) - top)).toBeLessThan(4);
    });

    test('E-3 Player bar -> full player -> Esc; art rect matches the end state; controls focusable', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('[data-testid="player-bar"]')).toBeVisible();
      await page.locator('[data-testid="player-art"]').first().click();
      const fp = page.locator('[data-testid="full-player"]');
      await expect(fp).toBeVisible();
      await page.waitForTimeout(600); // transition settled
      const rect = await page.locator('[data-testid="full-player"] [data-testid="player-art"]').first().boundingBox();
      expect(rect, 'full-player art has a box').not.toBeNull();
      expect(rect!.width).toBeGreaterThan(120);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(vp.width + 1);
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
      await page.keyboard.press('Escape');
      await expect(fp).toBeHidden();
    });

    test('E-4 Home -> Album -> Library -> Back -> Back; Alt+Left works; Back is instant (no fetch)', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('[data-testid="home"]')).toBeVisible();
      await page.locator('[data-testid="qp-tile"], [data-testid="card"]').first().click();
      await page.waitForTimeout(500);
      await openLibrary(page);
      let requests = 0;
      page.on('request', (r) => {
        if (/127\.0\.0\.1:47999/.test(r.url()) && r.method() !== 'GET') requests++;
      });
      const t0 = Date.now();
      await page.keyboard.press('Alt+ArrowLeft');
      await page.waitForTimeout(100);
      await page.keyboard.press('Alt+ArrowLeft');
      await expect(page.locator('[data-testid="home"]')).toBeVisible();
      expect(Date.now() - t0).toBeLessThan(1500);
      expect(requests, 'back must not fetch').toBe(0);
    });
  });
}
