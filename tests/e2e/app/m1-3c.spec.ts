import { test, expect } from '../fixtures/app';

// M1-3c on the real seeded core (run by integration, INT-W2): E-2 (End -> last row, scroll kept after Album -> Back) and E-9 (user album
// F2 / Del / persistence). Not run by the WP (no app builds). Needs the seeded library of the integration run (>= 5,000 songs).
test('app E-2: Library End reaches the last row; scroll kept after Album -> Back', async ({ app }) => {
  const p = app.page;
  await p.getByTestId('nav-library').click();
  const rows = p.locator('[data-testid="songs-table"] [data-testid="song-row"]');
  await expect(rows.first()).toBeVisible();
  await rows.first().click({ position: { x: 80, y: 28 } });
  await p.keyboard.press('End');
  const total = Number((await p.getByTestId('lib-count').textContent())!.replace(/\D/g, ''));
  await expect(p.locator(`[data-testid="songs-table"] [data-testid="song-row"][data-index="${total - 1}"]`)).toBeVisible({ timeout: 8000 });
  const top = await p.locator('[data-route="library"]').evaluate((e) => e.scrollTop);
  await rows.last().click({ button: 'right', position: { x: 80, y: 28 } });
  await p.locator('[data-id="go-album"]').click();
  await expect(p.getByTestId('album')).toBeVisible();
  await p.keyboard.press('Alt+ArrowLeft');
  await expect.poll(async () => Math.abs((await p.locator('[data-route="library"]').evaluate((e) => e.scrollTop)) - top)).toBeLessThan(4);
  await app.shot('m1-3c-library-end');
});

test('app E-9: user album rename (F2), Del, persists after reload', async ({ app }) => {
  const p = app.page;
  const name = `E9 app ${Date.now().toString(36).slice(-4)}`;
  await p.getByTestId('nav-library').click();
  await p.getByTestId('lib-create-album').click();
  await p.getByTestId('prompt-input').fill(name);
  await p.getByTestId('prompt-ok').click();
  const rows = p.locator('[data-testid="songs-table"] [data-testid="song-row"]');
  await rows.nth(0).click({ position: { x: 80, y: 28 } });
  await rows.nth(2).click({ position: { x: 80, y: 28 }, modifiers: ['Shift'] });
  await rows.nth(1).click({ button: 'right', position: { x: 80, y: 28 } });
  await p.locator('[data-id="add-album"]').hover();
  await p.locator('.mn[data-level="1"] [data-testid="menu-item"]').filter({ hasText: name }).dispatchEvent('click');
  const all = p.getByTestId('lib-albums-all');
  if (await all.isVisible()) await all.click();
  await p.getByTestId('lib-albums').getByTestId('card').filter({ hasText: name }).click();
  await expect(p.getByTestId('ua-table').getByTestId('song-row')).toHaveCount(3);
  await p.keyboard.press('F2');
  await p.getByTestId('prompt-input').fill(`${name} x`);
  await p.keyboard.press('Enter');
  await expect(p.getByTestId('ua-title')).toHaveText(`${name} x`);
  await p.getByTestId('ua-table').getByTestId('song-row').nth(0).click({ position: { x: 80, y: 28 } });
  await p.keyboard.press('Delete');
  await expect(p.getByTestId('ua-table').getByTestId('song-row')).toHaveCount(2);
  await p.reload();
  await expect(p.getByTestId('app')).toBeVisible();
  await p.getByTestId('nav-library').click();
  const all2 = p.getByTestId('lib-albums-all');
  if (await all2.isVisible()) await all2.click();
  await p.getByTestId('lib-albums').getByTestId('card').filter({ hasText: `${name} x` }).click();
  await expect(p.getByTestId('ua-table').getByTestId('song-row')).toHaveCount(2);
  await app.shot('m1-3c-useralbum');
});
