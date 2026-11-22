import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// M4-4b playlist import on the `web` project (Vite + mock-core). Ports 5196 / 48016: MM_WEB_PORT=5196 MOCK_PORT=48016.
const shots = path.resolve(__dirname, '../../../.testdata/m4-4b/shots');
fs.mkdirSync(shots, { recursive: true });

test.use({ viewport: { width: 1440, height: 900 } });

test('import: login (mock resolves) -> pick 2 playlists -> run -> progress -> done -> open album', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="home"]')).toBeVisible();
  await page.keyboard.press('Control+,');
  const shell = page.locator('[data-testid="settings"]:visible');
  await shell.locator('[data-testid="set-cat-import"]').click();
  const pg = shell.locator('[data-testid="set-page"][data-page="import"]');
  await expect(pg.locator('[data-testid="imp-provider"]')).toHaveCount(5);
  await expect(pg.locator('[data-provider="spotify"]')).toHaveAttribute('data-signed', 'false');
  await page.screenshot({ path: path.join(shots, 'providers.png') });

  // login shows the waiting state, then the provider is signed in and its playlists open
  const sp = pg.locator('[data-provider="spotify"]');
  await sp.locator('[data-testid="imp-login"]').click();
  await expect(sp.locator('[data-testid="imp-state"]')).toContainText(/Waiting for sign-in|Đang chờ đăng nhập/);
  await expect(sp).toHaveAttribute('data-signed', 'true');
  await expect(pg.locator('[data-testid="imp-pl"]')).toHaveCount(6);
  await expect(pg.locator('[data-testid="imp-run"]')).toBeDisabled();

  // pick 2
  await pg.locator('[data-testid="imp-pl"]').nth(0).click();
  await pg.locator('[data-testid="imp-pl"]').nth(2).click();
  await expect(pg.locator('[data-testid="imp-pl"][aria-checked="true"]')).toHaveCount(2);
  await page.screenshot({ path: path.join(shots, 'picker.png') });

  const albumsBefore = await page.evaluate(() => (window as any).__mmCalls.filter((c: any) => c.m === 'userAlbum.list').length);
  expect(albumsBefore).toBeGreaterThan(0);
  await pg.locator('[data-testid="imp-run"]').click();
  const job = pg.locator('[data-testid="imp-job"]');
  await expect(job).toHaveAttribute('data-phase', 'running');
  await job.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, 'running.png') });
  await expect(job).toHaveAttribute('data-phase', 'done');
  await expect(job.locator('[data-testid="imp-failed"] li').first()).toBeVisible();
  const runCall = await page.evaluate(() => (window as any).__mmCalls.find((c: any) => c.m === 'import.run').p);
  expect(runCall).toMatchObject({ provider: 'spotify', target: 'newUserAlbum' });
  expect(runCall.playlistIds).toEqual(['spotify-pl1', 'spotify-pl3']);
  await job.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, 'done.png') });

  await job.locator('[data-testid="imp-open-album"]').click();
  await expect(page.locator('.pg[data-route="userAlbum"]:not(.hid)')).toHaveCount(1);
  await page.screenshot({ path: path.join(shots, 'album.png') });
});
