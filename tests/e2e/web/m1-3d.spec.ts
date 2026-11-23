import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

// M1-3d collection pages: Album, Artist (+ About), Playlist, Podcast. Web project (Vite + mock-core).
// Run with MM_WEB_PORT=5187 MOCK_PORT=48007. E-4 extended, E-10, save/subscribe toggles, sticky bar, play contexts, cursor paging.
const base = process.env.MM_WEB_URL ?? (process.env.MM_WEB_PORT ? `http://127.0.0.1:${process.env.MM_WEB_PORT}` : undefined);
if (base) test.use({ baseURL: base });
test.use({ viewport: { width: 1536, height: 960 }, deviceScaleFactor: 1 });

const SHOTS = process.env.MM_SHOTS_DIR ?? path.resolve(__dirname, '../../../../shots-M1-3d');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

const PLAYLIST = 'VLPLQKOUCxZSauQgq7sPzO9XCeGh3qqOuA8i';
const PODCAST = 'MPSPmock0001';

async function boot(page: Page, lang = 'en') {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`/?lang=${lang}`);
  await expect(page.getByTestId('app')).toBeVisible();
  await expect(page.getByTestId('home')).toBeVisible();
}
/** Test seam of dev builds: the router module is a singleton, so importing it from the page navigates the running app. */
const go = (page: Page, name: string, params: Record<string, string>) =>
  page.evaluate(async ([n, p]) => {
    const r = await import(/* @vite-ignore */ '/src/router/router.ts');
    (r as any).navigate(n, p);
  }, [name, params] as const);
const calls = (page: Page, m?: string) =>
  page.evaluate((method) => ((window as any).__mmCalls as { m: string; p: any }[]).filter((c) => !method || c.m === method), m);
const clearCalls = (page: Page) => page.evaluate(() => ((window as any).__mmCalls.length = 0));
const visiblePage = (page: Page, route: string) => page.locator(`.pg[data-route="${route}"]:not(.hid)`);
const xbutton = (page: Page, button: 3 | 4) =>
  page.evaluate((b) => window.dispatchEvent(new MouseEvent('mouseup', { button: b, bubbles: true, cancelable: true })), button);

test.describe('E-4 extended: Home > Album > Artist > Back > Back', () => {
  for (const how of ['alt', 'xbutton', 'titlebar'] as const) {
    test(`back with ${how}: keep-alive, no refetch`, async ({ page }) => {
      await boot(page);
      await page.locator('[data-testid="shelf"] [data-testid="card"]').first().click();
      await expect(page.getByTestId('album')).toBeVisible();
      await expect(page.getByTestId('coll-title')).toBeVisible();
      await expect(page.locator('.ch-meta .lnk').first()).toBeVisible(); // artist links of the header
      await go(page, 'artist', { id: 'UCg-Ds_COVaFZp8UNDZTfie6' });
      await expect(page.getByTestId('artist')).toBeVisible();
      await expect(page.getByTestId('artist-name')).toBeVisible();
      await shot(page, `e4-${how}-artist`);
      await clearCalls(page);
      const back = async () => {
        if (how === 'alt') await page.keyboard.press('Alt+ArrowLeft');
        else if (how === 'xbutton') await xbutton(page, 3);
        else await page.getByTestId('nav-back').click();
      };
      await back();
      await expect(visiblePage(page, 'album')).toBeVisible();
      await expect(page.getByTestId('coll-title')).toBeVisible(); // already rendered: no skeleton
      await back();
      await expect(visiblePage(page, 'home')).toBeVisible();
      for (const m of ['album.get', 'artist.get', 'home.get']) expect(await calls(page, m), `${m} after back`).toHaveLength(0);
      // forward again is instant too
      if (how === 'xbutton') await xbutton(page, 4);
      else await page.keyboard.press('Alt+ArrowRight');
      await expect(visiblePage(page, 'album')).toBeVisible();
      expect(await calls(page, 'album.get')).toHaveLength(0);
    });
  }
});

test.describe('Album', () => {
  test('header, sticky bar via sentinel, Phát / Trộn bài / row double-click contexts, save toggle', async ({ page }) => {
    await boot(page);
    await go(page, 'album', { id: 'MPREb_mockAlbum01' });
    await expect(page.getByTestId('album-table')).toBeVisible();
    await expect(visiblePage(page, 'album').getByTestId('song-row').first()).toBeVisible();
    const art = await page.locator('.al-head .al-art').boundingBox();
    expect(art!.width).toBeCloseTo(232, 1); // layout may round to a subpixel (231.99997)
    await shot(page, 'album-header');

    // sticky bar: hidden at the top, shown once the header has scrolled away (IntersectionObserver, no scroll handler)
    const bar = visiblePage(page, 'album').getByTestId('coll-sticky');
    await expect(bar).toHaveAttribute('data-on', '0');
    await page.evaluate(() => (document.querySelector('.pg:not(.hid)') as HTMLElement).scrollTo(0, 420));
    await expect(bar).toHaveAttribute('data-on', '1');
    expect((await bar.boundingBox())!.height).toBe(56);
    await shot(page, 'album-sticky');
    await page.evaluate(() => (document.querySelector('.pg:not(.hid)') as HTMLElement).scrollTo(0, 0));
    await expect(bar).toHaveAttribute('data-on', '0');

    await clearCalls(page);
    await page.getByTestId('coll-play').click();
    await page.getByTestId('coll-shuffle').click();
    const play = await calls(page, 'player.play');
    expect(play[0].p).toEqual({ context: { kind: 'album', id: 'MPREb_mockAlbum01' } });
    expect(play[1].p).toEqual({ context: { kind: 'album', id: 'MPREb_mockAlbum01' }, shuffle: true });

    const row = visiblePage(page, 'album').getByTestId('song-row').nth(2);
    const id = await page.evaluate(() => null); // placeholder to keep the order explicit
    void id;
    await row.dblclick();
    const dbl = (await calls(page, 'player.play')).at(-1)!;
    expect(dbl.p.context).toEqual({ kind: 'album', id: 'MPREb_mockAlbum01' });
    expect(typeof dbl.p.startId).toBe('string');

    // save toggle calls album.save with {id,on} both ways
    await clearCalls(page);
    await page.getByTestId('coll-save').click();
    await expect(page.getByTestId('coll-save')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('coll-save').click();
    const saves = await calls(page, 'album.save');
    expect(saves.map((c) => c.p)).toEqual([
      { id: 'MPREb_mockAlbum01', on: true },
      { id: 'MPREb_mockAlbum01', on: false },
    ]);
    await expect(page.getByTestId('coll-download')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('shelf-versions')).toHaveCount(1);
    await expect(page.getByTestId('shelf-more-by')).toHaveCount(1);
  });
});

test.describe('Artist', () => {
  test('subscribe / play / radio call the right methods; top songs 5 rows; See all is a cursor sub-view', async ({ page }) => {
    await boot(page);
    await go(page, 'artist', { id: 'UCg-Ds_COVaFZp8UNDZTfie6' });
    await expect(page.getByTestId('artist-name')).toBeVisible();
    await expect(page.getByTestId('artist-top-table').getByTestId('song-row')).toHaveCount(5);
    expect((await page.getByTestId('artist-banner').boundingBox())!.height).toBeCloseTo(232, 1);
    await shot(page, 'artist');

    await clearCalls(page);
    await page.getByTestId('artist-subscribe').click();
    await expect(page.getByTestId('artist-subscribe')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('artist-subscribe').click();
    expect((await calls(page, 'artist.subscribe')).map((c) => c.p)).toEqual([
      { id: 'UCg-Ds_COVaFZp8UNDZTfie6', on: true },
      { id: 'UCg-Ds_COVaFZp8UNDZTfie6', on: false },
    ]);
    await page.getByTestId('artist-play').click();
    await page.getByTestId('artist-radio').click();
    const p = await calls(page, 'player.play');
    expect(p[0].p).toEqual({ context: { kind: 'artist', id: 'UCg-Ds_COVaFZp8UNDZTfie6' } });
    expect(p[1].p).toEqual({ context: { kind: 'radio', id: 'UCg-Ds_COVaFZp8UNDZTfie6' } });

    // top song double-click: artist context + startId
    await page.getByTestId('artist-top-table').getByTestId('song-row').nth(1).dblclick();
    const d = (await calls(page, 'player.play')).at(-1)!;
    expect(d.p.context.kind).toBe('artist');
    expect(typeof d.p.startId).toBe('string');

    // Xem tất cả: sub-view inside the same route, artist.tracks cursor, Esc returns
    await page.getByTestId('artist-see-all').click();
    await expect(page.getByTestId('artist-all')).toBeVisible();
    await expect(page.getByTestId('artist-all-table').getByTestId('song-row').first()).toBeVisible();
    expect((await calls(page, 'artist.tracks')).length).toBeGreaterThan(0);
    await shot(page, 'artist-all');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('artist-top')).toBeVisible();
    await expect(page.locator('.pg:not(.hid)')).toHaveAttribute('data-route', 'artist');
  });

  test('About card opens artistAbout (bio, listeners, tags)', async ({ page }) => {
    await boot(page);
    await go(page, 'artist', { id: 'UCg-Ds_COVaFZp8UNDZTfie6' });
    await page.getByTestId('artist-about-card').locator('.art-about').click();
    await expect(page.getByTestId('artist-about')).toBeVisible();
    await expect(page.getByTestId('about-bio')).toContainText('mock core');
    await expect(page.getByTestId('about-tags').locator('.chip')).toHaveCount(3);
    await shot(page, 'artist-about');
    expect((await calls(page, 'artist.get')).length).toBe(1); // About reuses the artist page-store entry
    await page.getByTestId('about-back').click();
    await expect(visiblePage(page, 'artist')).toBeVisible();
  });

  test('E-10: shelf ‹ › buttons scroll the shelf; a vertical wheel over a shelf scrolls the page', async ({ page }) => {
    await boot(page);
    await go(page, 'artist', { id: 'UCg-Ds_COVaFZp8UNDZTfie6' });
    const section = page.getByTestId('shelf-related');
    await expect(section).toBeVisible();
    const shelf = section.getByTestId('shelf');
    await expect(shelf.getByTestId('card').first()).toBeVisible();
    const sl = () => shelf.evaluate((e) => e.scrollLeft);
    expect(await sl()).toBe(0);
    await section.getByTestId('shelf-right').click();
    await expect.poll(sl).toBeGreaterThan(100);
    await section.getByTestId('shelf-left').click();
    await expect.poll(sl).toBe(0);

    await shelf.scrollIntoViewIfNeeded();
    const b = (await shelf.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    const top0 = await page.evaluate(() => (document.querySelector('.pg:not(.hid)') as HTMLElement).scrollTop);
    // the shelf can sit at the very end of the page (data dependent): wheel towards the side that still has room
    const room = await page.evaluate(() => { const e = document.querySelector('.pg:not(.hid)') as HTMLElement; return e.scrollHeight - e.clientHeight - e.scrollTop; });
    const dy = room >= 300 ? 300 : -300;
    await page.mouse.wheel(0, dy);
    await expect.poll(() => page.evaluate(() => (document.querySelector('.pg:not(.hid)') as HTMLElement).scrollTop)).not.toBe(top0);
    expect(await sl()).toBe(0); // vertical wheel never becomes horizontal scroll
  });
});

test.describe('Playlist', () => {
  test('cursor paging past 60 rows switches to VirtualList; Phát / Trộn bài / save', async ({ page }) => {
    await boot(page);
    await go(page, 'playlist', { id: PLAYLIST });
    await expect(page.getByTestId('playlist-table')).toBeVisible();
    await expect(visiblePage(page, 'playlist').getByTestId('song-row').first()).toBeVisible();
    await expect(page.getByTestId('coll-title')).toBeVisible();
    // mock page size is 100: the first page already exceeds 60 rows, so the table is virtualised
    await expect(page.getByTestId('songs-list')).toBeVisible();
    const rendered = await visiblePage(page, 'playlist').getByTestId('song-row').count();
    expect(rendered).toBeLessThan(100);
    await shot(page, 'playlist');
    // scroll to the end: the sentinel pulls the next cursor pages (300 rows in the mock)
    await page.evaluate(() => (document.querySelector('.pg:not(.hid)') as HTMLElement).scrollTo(0, 1e6));
    await expect.poll(async () => (await calls(page, 'playlist.get')).length).toBeGreaterThanOrEqual(2);
    const cursors = (await calls(page, 'playlist.get')).map((c) => c.p.cursor);
    expect(cursors[0]).toBeUndefined();
    expect(cursors[1]).toBe('pl:100');
    expect(new Set(cursors).size).toBe(cursors.length); // a page is never requested twice
    await expect.poll(async () => page.getByTestId('songs-list').evaluate((e) => parseInt((e as HTMLElement).style.height))).toBeGreaterThan(100 * 56);

    await page.evaluate(() => (document.querySelector('.pg:not(.hid)') as HTMLElement).scrollTo(0, 0));
    await clearCalls(page);
    await page.getByTestId('coll-play').click();
    await page.getByTestId('coll-shuffle').click();
    const pl = await calls(page, 'player.play');
    expect(pl[0].p).toEqual({ context: { kind: 'playlist', id: PLAYLIST } });
    expect(pl[1].p).toEqual({ context: { kind: 'playlist', id: PLAYLIST }, shuffle: true });
    await page.getByTestId('coll-save').click();
    expect((await calls(page, 'playlist.save'))[0].p).toEqual({ id: PLAYLIST, on: true });
  });

  test('sticky bar appears after scrolling', async ({ page }) => {
    await boot(page);
    await go(page, 'playlist', { id: PLAYLIST });
    await expect(visiblePage(page, 'playlist').getByTestId('song-row').first()).toBeVisible();
    const bar = visiblePage(page, 'playlist').getByTestId('coll-sticky');
    await expect(bar).toHaveAttribute('data-on', '0');
    await page.evaluate(() => (document.querySelector('.pg:not(.hid)') as HTMLElement).scrollTo(0, 600));
    await expect(bar).toHaveAttribute('data-on', '1');
    await bar.getByTestId('coll-sticky-play').click();
    expect((await calls(page, 'player.play')).at(-1)!.p).toEqual({ context: { kind: 'playlist', id: PLAYLIST } });
  });
});

test.describe('Podcast', () => {
  test('episodes by cursor with duration and progress line', async ({ page }) => {
    await boot(page);
    await go(page, 'podcast', { id: PODCAST });
    await expect(page.getByTestId('coll-title')).toContainText('Podcast');
    await expect(page.getByTestId('episode-row').first()).toBeVisible();
    expect(await page.getByTestId('episode-row').count()).toBeGreaterThanOrEqual(10);
    await expect(page.getByTestId('episode-row').first().locator('.ep-bar')).toHaveCount(1);
    await shot(page, 'podcast');
    await page.evaluate(() => (document.querySelector('.pg:not(.hid)') as HTMLElement).scrollTo(0, 1e6));
    await expect.poll(() => page.getByTestId('episode-row').count()).toBe(30);
    await clearCalls(page);
    await page.getByTestId('episode-row').nth(1).dblclick();
    const p = (await calls(page, 'player.play'))[0];
    expect(p.p.context).toEqual({ kind: 'album', id: PODCAST });
    expect(typeof p.p.startId).toBe('string');
  });
});

test.describe('Vietnamese header screenshots', () => {
  test('album and artist in vi', async ({ page }) => {
    await boot(page, 'vi');
    await go(page, 'album', { id: 'MPREb_mockAlbum01' });
    await expect(page.getByTestId('coll-title')).toBeVisible();
    await expect(page.getByTestId('coll-play')).toContainText('Phát');
    await shot(page, 'album-vi');
  });
});

// Perf proxy (indicative): 20 push/pop transitions between Album and Artist, dropped frames per transition from rAF gaps.
// The machine may be busy (other agents, software rendering), so the same measurement is taken with no transition (idle) and on
// a cheap pair of routes (Home <-> Library); the criterion is "<= 1 dropped frame more than the cheap pair".
test('perf proxy: 20 push/pop transitions, <= 1 dropped frame each (relative to the noise floor)', async ({ page }) => {
  await boot(page);
  await go(page, 'library', {});
  await page.waitForTimeout(500);
  const measure = (n: number) =>
    page.evaluate(async (count) => {
      const r: any = await import(/* @vite-ignore */ '/src/router/router.ts');
      const frames = (ms: number) =>
        new Promise<number>((resolve) => {
          const t: number[] = [];
          const tick = (x: number) => {
            t.push(x);
            if (x - t[0] < ms) requestAnimationFrame(tick);
            else {
              let dropped = 0;
              for (let i = 1; i < t.length; i++) dropped += Math.max(0, Math.round((t[i] - t[i - 1]) / 16.67) - 1);
              resolve(dropped);
            }
          };
          requestAnimationFrame(tick);
        });
      const out: number[] = [];
      for (let i = 0; i < count; i++) {
        if (i % 2 === 0) r.back();
        else r.forward();
        out.push(await frames(450));
      }
      return out;
    }, n);
  const idle = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const t: number[] = [];
        const tick = (x: number) => {
          t.push(x);
          if (x - t[0] < 4500) requestAnimationFrame(tick);
          else resolve(t.slice(1).reduce((d, v, i) => d + Math.max(0, Math.round((v - t[i]) / 16.67) - 1), 0));
        };
        requestAnimationFrame(tick);
      })
  );
  const cheap = await measure(20); // Home <-> Library
  await go(page, 'album', { id: 'MPREb_mockAlbum01' });
  await expect(visiblePage(page, 'album').getByTestId('song-row').first()).toBeVisible();
  await go(page, 'artist', { id: 'UCg-Ds_COVaFZp8UNDZTfie6' });
  await expect(page.getByTestId('artist-name')).toBeVisible();
  const ours = await measure(20);
  const mx = (a: number[]) => Math.max(...a);
  console.log('idle dropped per 4.5 s:', idle, '| cheap pair:', JSON.stringify(cheap), '| album<->artist:', JSON.stringify(ours));
  fs.writeFileSync(path.join(SHOTS, 'perf-proxy.json'), JSON.stringify({ idleDroppedPer4500ms: idle, cheapPair: cheap, albumArtist: ours }, null, 1));
  expect(mx(ours)).toBeLessThanOrEqual(mx(cheap) + 1);
});
