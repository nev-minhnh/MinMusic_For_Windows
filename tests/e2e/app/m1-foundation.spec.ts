import { test, expect } from '../fixtures/app';

// App project (WebView2 over CDP, run by integration): the song context menu at 1536x960 CSS px / DPR 2.5, compared with MK frame 3.
// The page under test is the dev route #/dev/table, so the app must be built with VITE_E2E=1 (see notes in STATUS.md).
test('app: song context menu at 1536x960 DPR 2.5, screenshot for the MK 3 crop', async ({ app }) => {
  await app.page.evaluate(() => (location.hash = '#/dev/table'));
  const row = app.page.locator('.pg:not(.hid) [data-testid="song-row"]').nth(2);
  await expect(row).toBeVisible();
  const b = (await row.boundingBox())!;
  await app.page.mouse.click(b.x + b.width - 60, b.y + 20, { button: 'right' });
  await expect(app.page.locator('[data-testid="menu"]')).toHaveCount(1);
  const ids = await app.page.locator('.mn[data-level="0"] [data-testid="menu-item"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));
  expect(ids).toEqual(['play-next', 'add-queue', 'add-album', 'download', 'sources', 'go-artist', 'go-album', 'copy-link', 'info']);
  const mb = (await app.page.locator('.mn[data-level="0"]').boundingBox())!;
  expect(mb.width).toBeCloseTo(272, 0);
  await app.page.locator('[data-id="add-album"]').hover();
  await expect(app.page.locator('.mn[data-level="1"]')).toHaveAttribute('data-flip', 'left');
  const f = await app.shot('m1-menu-mk3');
  expect(f).toMatch(/m1-menu-mk3\.png$/);
  await app.page.keyboard.press('Escape');
  // the app is shared by the next specs: leave the dev route (it replaces the shell, so global shortcuts such as Ctrl E do not work)
  await app.page.evaluate(() => { location.hash = '#/home'; location.reload(); }); // the dev route replaces the whole shell: reload it
  await expect(app.page.locator('[data-testid="home"]')).toBeVisible();
});
