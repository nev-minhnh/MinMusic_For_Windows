import { test, expect, type Page } from '@playwright/test';
import WebSocket from 'ws';
import { mkdirSync } from 'node:fs';

// M2-2: queue pane, lyrics, full player, bar extras (web project: Vite + mock-core on this WP's ports 5188 / 48008).
// E-20 queue pane, E-21 reorder, E-22 remove, E-23 clear + autoplay, E-24 line timing, E-25 word timing,
// E-26 click to seek, E-27 manual scroll pause, E-28 F11, E-29 full player (E-3 at final fidelity), E-30 bar extras.
// The mock plays in real time; lyrics lines are 5 s apart from 4 s (mock-core/src/handlers/lyrics.ts).
const MOCK = Number(process.env.MOCK_PORT) || 47999;
const LINE_START = 4000;
const LINE_STEP = 5000;
const SHOTS = process.env.MM_SHOTS_DIR ?? '.testdata/m2-2-shots';
mkdirSync(SHOTS, { recursive: true });

/** One RPC against the mock core (a second connection: the state is shared with the page's connection). */
function core<T = any>(m: string, p: object = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${MOCK}/rpc`);
    const t = setTimeout(() => { ws.terminate(); reject(new Error(`${m}: timeout`)); }, 10_000);
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, m: 'sys.hello', p: { token: 'dev', role: 'ui', protocol: 1, client: 'e2e', locale: 'vi' } })));
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString());
      if (msg.id === 1) ws.send(JSON.stringify({ id: 2, m, p }));
      else if (msg.id === 2) {
        clearTimeout(t);
        ws.close();
        msg.e ? reject(new Error(`${m}: ${msg.e.code}`)) : resolve(msg.r);
      }
    });
  });
}
async function playTracks(n = 12, startIndex = 0): Promise<string[]> {
  const w = await core('library.window', { list: 'songs', sort: { by: 'added', desc: true }, offset: 0, limit: 100 });
  const ids: string[] = w.items.slice(0, n).map((t: any) => t.id);
  await core('player.play', { context: { kind: 'tracks', ids, title: 'e2e' }, startIndex });
  return ids;
}
const qIds = async () => (await core('queue.window', { offset: 0, limit: 200 })).items.map((i: any) => i.id as string);
const calls = (page: Page, m: string) => page.evaluate((mm) => ((window as any).__mmCalls as { m: string; p: any }[]).filter((c) => c.m === mm).map((c) => c.p), m);
const pos = (page: Page) => page.evaluate(() => (window as any).__mmPos() as number);

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('[data-testid="player-bar"]')).toBeVisible();
  await expect(page.locator('[data-testid="play-pause"]')).toBeVisible();
}
async function openPane(page: Page, tab: 'q' | 'l' = 'q') {
  await page.keyboard.press(tab);
  await expect(page.locator('[data-testid="support-pane"]')).toBeVisible();
}
async function openFull(page: Page) {
  await page.keyboard.press('t');
  await expect(page.locator('[data-testid="full-player"]')).toBeVisible();
  await page.waitForTimeout(550);
}

test.use({ viewport: { width: 1536, height: 960 } });

test.describe('queue pane', () => {
  test('E-20 Q opens the pane (docked, 336), rows are 56 px on a virtual list, current row on top', async ({ page }) => {
    const ids = await playTracks(60, 0);
    await open(page);
    await openPane(page, 'q');
    const pane = page.locator('[data-testid="support-pane"]');
    const box = (await pane.boundingBox())!;
    expect(Math.round(box.width)).toBe(336);
    await expect(pane).toHaveClass(/docked/);
    // content kept >= 760
    const main = (await page.locator('main.main').boundingBox())!;
    expect(main.width).toBeGreaterThanOrEqual(760);
    await expect(page.locator('[data-testid="queue-current"]')).toBeVisible();
    const rows = page.locator('[data-testid="queue-row"]');
    await expect(rows.first()).toBeVisible();
    expect((await rows.first().boundingBox())!.height).toBe(56);
    expect(await rows.first().getAttribute('data-qi')).toBe('1');
    // virtualised: far fewer DOM rows than the 59 upcoming ones
    expect(await rows.count()).toBeLessThan(59);
    expect(ids.length).toBe(60);
    // Q again closes, main grows back
    await page.keyboard.press('q');
    await expect(pane).toBeHidden();
  });

  test('E-20b narrow window: the pane overlays the content, no scrim, Esc closes it', async ({ page }) => {
    await playTracks(12, 0);
    await page.setViewportSize({ width: 1100, height: 800 });
    await open(page);
    await openPane(page, 'q');
    const pane = page.locator('[data-testid="support-pane"]');
    await expect(pane).toHaveClass(/ovl/);
    const main0 = (await page.locator('main.main').boundingBox())!;
    expect(main0.width).toBeGreaterThan(900); // not squeezed
    expect(await page.locator('.dlg-scrim').count()).toBe(0);
    await page.keyboard.press('Escape');
    await expect(pane).toBeHidden();
  });

  test('E-21 drag reorder -> queue.move {from,to,expectedRevision}; order follows', async ({ page }) => {
    const ids = await playTracks(12, 0);
    await open(page);
    await openPane(page, 'q');
    const row = (qi: number) => page.locator(`[data-testid="queue-row"][data-qi="${qi}"]`);
    await expect(row(4)).toBeVisible();
    await row(4).dragTo(row(2), { targetPosition: { x: 120, y: 4 } });
    await expect.poll(async () => (await qIds()).slice(0, 6).join(',')).toBe([ids[0], ids[1], ids[4], ids[2], ids[3], ids[5]].join(','));
    const mv = await calls(page, 'queue.move');
    expect(mv.length).toBe(1);
    expect(mv[0]).toMatchObject({ from: 4, to: 2 });
    expect(typeof mv[0].expectedRevision).toBe('number');
    // the list refetched (queue.changed): the dragged track is now the first upcoming rows' neighbour
    await expect(row(2)).toContainText(/\S/);
    await page.screenshot({ path: `${SHOTS}/queue-reorder.png` });
  });

  test('E-22 Del and the row button remove items', async ({ page }) => {
    const ids = await playTracks(12, 0);
    await open(page);
    await openPane(page, 'q');
    const row = (qi: number) => page.locator(`[data-testid="queue-row"][data-qi="${qi}"]`);
    await row(3).click();
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await qIds()).length).toBe(11);
    expect((await qIds()).includes(ids[3]!)).toBe(false);
    await row(2).hover();
    await row(2).locator('[data-testid="queue-remove"]').click();
    await expect.poll(async () => (await qIds()).length).toBe(10);
    expect((await calls(page, 'queue.remove')).length).toBe(2);
  });

  test('E-23 "Xoá" keeps the current item; the Tự động phát switch calls queue.setAutoplay', async ({ page }) => {
    const ids = await playTracks(12, 2);
    await open(page);
    await openPane(page, 'q');
    await page.locator('[data-testid="queue-clear"]').click();
    await expect.poll(async () => (await qIds()).join(',')).toBe(ids[2]);
    expect((await calls(page, 'queue.clear'))[0]).toEqual({ keepCurrent: true });
    const sw = page.locator('[data-testid="autoplay-switch"]');
    const was = (await sw.getAttribute('aria-checked')) === 'true';
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', String(!was));
    expect((await calls(page, 'queue.setAutoplay')).at(-1)).toEqual({ on: !was });
    await sw.click();
    expect((await calls(page, 'queue.setAutoplay')).at(-1)).toEqual({ on: was });
  });

  test('E-23b double-click plays that row (queue.select); dropping tracks on the pane adds them (queue.add end)', async ({ page }) => {
    const ids = await playTracks(12, 0);
    await open(page);
    await openPane(page, 'q');
    await page.locator('[data-testid="queue-row"][data-qi="5"]').dblclick();
    await expect.poll(async () => (await core('queue.window', { offset: 0, limit: 1 })).currentIndex).toBe(5);
    expect((await calls(page, 'queue.select')).length).toBe(1);
    const extra = (await core('library.window', { list: 'songs', sort: { by: 'added', desc: true }, offset: 100, limit: 2 })).items.map((t: any) => t.id);
    // synthesize the drop of M1-3a's drag payload
    await page.evaluate((payload) => {
      const el = document.querySelector('[data-testid="queue-panel"]')!;
      const dt = new DataTransfer();
      dt.setData('application/x-mm-tracks', JSON.stringify({ ids: payload }));
      for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, extra);
    await expect.poll(async () => (await qIds()).length).toBe(ids.length + 2);
    expect((await qIds()).slice(-2)).toEqual(extra);
  });
});

test.describe('lyrics', () => {
  async function lyricsFor(trackId: string, candidate: 'lrclib-line' | 'kugou-word') {
    await core('lyrics.choose', { trackId, candidateId: candidate });
    await core('lyrics.setOffset', { trackId, ms: 0 });
    return core('lyrics.get', { trackId });
  }
  /** Records every change of the current line / word with the interpolated clock. */
  const observe = (page: Page) =>
    page.evaluate(() => {
      const w = window as any;
      w.__lyEv = [];
      let li = -1, wi = -1;
      const scan = () => {
        const cur = document.querySelector('.lyv-scroll .ll.cur') as HTMLElement | null;
        const i = cur ? Number(cur.dataset.i) : -1;
        if (i !== li) { li = i; w.__lyEv.push({ kind: 'line', i, pos: w.__mmPos() }); }
        const cw = cur?.querySelector('.w.cw') as HTMLElement | null;
        const k = cw ? Number(cw.dataset.k) : -1;
        if (k !== wi || (i !== li && k >= 0)) { wi = k; if (k >= 0) w.__lyEv.push({ kind: 'word', i, k, pos: w.__mmPos() }); }
      };
      new MutationObserver(scan).observe(document.querySelector('.lyv-scroll')!, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
      scan();
    });

  test('E-24 line sync: the current line changes within 50 ms of the clock', async ({ page }) => {
    const [id] = await playTracks(3, 0);
    await lyricsFor(id!, 'lrclib-line');
    await open(page);
    await openFull(page);
    await expect(page.locator('.lyv-scroll .ll').first()).toBeVisible();
    await observe(page);
    await expect.poll(() => page.evaluate(() => (window as any).__lyEv.filter((e: any) => e.kind === 'line' && e.i >= 0).length), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
    const evs: any[] = (await page.evaluate(() => (window as any).__lyEv)).filter((e: any) => e.kind === 'line' && e.i >= 0);
    for (const e of evs) expect(Math.abs(e.pos - (LINE_START + e.i * LINE_STEP)), `line ${e.i} at ${e.pos}`).toBeLessThanOrEqual(50);
    // classes: past 72 %, current ink
    const cur = page.locator('.lyv-scroll .ll.cur');
    expect(await cur.evaluate((e) => getComputedStyle(e).color)).toBe(await page.evaluate(() => getComputedStyle(document.body).color));
    await page.screenshot({ path: `${SHOTS}/lyrics-line.png` });
  });

  test('E-25 word sync: words flip within 50 ms; the wipe animation tracks the clock', async ({ page }) => {
    const [id] = await playTracks(3, 0);
    const ly = await lyricsFor(id!, 'kugou-word');
    await open(page);
    await openFull(page);
    await expect(page.locator('.lyv[data-synced="word"]')).toBeVisible();
    await observe(page);
    await expect.poll(() => page.evaluate(() => (window as any).__lyEv.filter((e: any) => e.kind === 'word').length), { timeout: 20_000 }).toBeGreaterThanOrEqual(6);
    const evs: any[] = (await page.evaluate(() => (window as any).__lyEv)).filter((e: any) => e.kind === 'word');
    for (const e of evs) {
      const w = ly.lines[e.i].words[e.k];
      expect(Math.abs(e.pos - w.t), `word ${e.i}.${e.k} at ${e.pos} vs ${w.t}`).toBeLessThanOrEqual(50);
    }
    // the wipe: current word's animation time ~ clock - word start
    const probe = await page.evaluate(() => {
      const cw = document.querySelector('.lyv-scroll .ll.cur .w.cw') as HTMLElement | null;
      const wf = cw?.querySelector('.wf') as HTMLElement | null;
      const a = wf?.getAnimations()[0];
      return cw && a ? { k: Number(cw.dataset.k), i: Number((cw.closest('.ll') as HTMLElement).dataset.i), t: Number(a.currentTime ?? -1), pos: (window as any).__mmPos(), running: a.playState } : null;
    });
    expect(probe).not.toBeNull();
    const w = ly.lines[probe!.i].words[probe!.k];
    expect(Math.abs(probe!.t - Math.min(probe!.pos - w.t, w.end - w.t))).toBeLessThan(120);
    await page.screenshot({ path: `${SHOTS}/lyrics-word.png` });
  });

  test('E-26 click a line -> player.seek; the clock jumps', async ({ page }) => {
    const [id] = await playTracks(3, 0);
    await lyricsFor(id!, 'lrclib-line');
    await open(page);
    await openFull(page);
    const line = page.locator('.lyv-scroll .ll[data-i="5"]');
    await expect(line).toBeVisible();
    await line.click();
    await expect.poll(async () => (await calls(page, 'player.seek')).length).toBe(1);
    const ms = (await calls(page, 'player.seek'))[0].ms;
    expect(Math.abs(ms - (LINE_START + 5 * LINE_STEP))).toBeLessThanOrEqual(1);
    await expect.poll(() => pos(page)).toBeGreaterThan(LINE_START + 5 * LINE_STEP - 300);
    await expect(page.locator('.lyv-scroll .ll.cur')).toHaveAttribute('data-i', /^[56]$/);
  });

  test('E-27 manual scroll pauses auto-follow for 4 s, then it resumes', async ({ page }) => {
    const [id] = await playTracks(3, 0);
    await lyricsFor(id!, 'lrclib-line');
    await core('player.seek', { ms: 11_000 }); // line 1 now, line 2 at 14 s
    await open(page);
    await openFull(page);
    const sc = page.locator('[data-testid="lyrics-scroll"]');
    await expect(page.locator('.lyv-scroll .ll.cur')).toHaveAttribute('data-i', '1');
    await page.waitForTimeout(700);
    await sc.hover();
    await page.mouse.wheel(0, 700);
    const t0 = Date.now();
    await page.waitForTimeout(400);
    const st1 = await sc.evaluate((e) => e.scrollTop);
    expect(st1).toBeGreaterThan(200);
    // the line changes during the pause (14 s), the scroller must not move
    await expect(page.locator('.lyv-scroll .ll.cur')).toHaveAttribute('data-i', '2', { timeout: 6000 });
    await page.waitForTimeout(Math.max(0, 3300 - (Date.now() - t0)));
    expect(Math.abs((await sc.evaluate((e) => e.scrollTop)) - st1)).toBeLessThan(3);
    // after 4 s it follows again
    await page.waitForTimeout(Math.max(0, 5200 - (Date.now() - t0)));
    await expect.poll(async () => Math.abs((await sc.evaluate((e) => e.scrollTop)) - st1), { timeout: 3000 }).toBeGreaterThan(40);
  });

  test('E-28 F11 toggles lyrics fullscreen (40/52, max 960); Esc peels it before the player', async ({ page }) => {
    const [id] = await playTracks(3, 0);
    await lyricsFor(id!, 'lrclib-line');
    await open(page);
    await openFull(page);
    await page.keyboard.press('F11');
    const fs = page.locator('[data-testid="lyrics-fullscreen"]');
    await expect(fs).toBeVisible();
    const st = await fs.locator('.ll').first().evaluate((e) => ({ f: getComputedStyle(e).fontSize, l: getComputedStyle(e).lineHeight }));
    expect(st).toEqual({ f: '40px', l: '52px' });
    const w = (await fs.locator('.lyv-scroll').boundingBox())!.width;
    expect(w).toBeLessThanOrEqual(960);
    await page.screenshot({ path: `${SHOTS}/lyrics-fullscreen.png` });
    await page.keyboard.press('Escape');
    await expect(fs).toBeHidden();
    await expect(page.locator('[data-testid="full-player"]')).toBeVisible();
    await page.keyboard.press('F11');
    await expect(fs).toBeVisible();
    await page.keyboard.press('F11');
    await expect(fs).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="full-player"]')).toBeHidden();
  });

  test('E-28b translate chip, romanize, offset and "Tìm lời khác" call the core', async ({ page }) => {
    const [id] = await playTracks(3, 0);
    await lyricsFor(id!, 'kugou-word');
    await open(page);
    await openFull(page);
    await page.getByRole('button', { name: /Dịch|Translate/ }).first().click();
    await expect(page.locator('.lyv-scroll .ltr').first()).toBeVisible();
    expect((await calls(page, 'lyrics.translate'))[0]).toMatchObject({ trackId: id, on: true });
    await page.locator('[data-testid="lyrics-more"]').first().click();
    await page.locator('[data-testid="offset-plus"]').click();
    await expect.poll(async () => (await calls(page, 'lyrics.setOffset')).at(-1)?.ms).toBe(100);
    await expect(page.locator('[data-testid="offset-value"]')).toContainText('0.1');
    await page.locator('[data-testid="romanize-switch"]').click();
    await expect(page.locator('.lyv-scroll .lro').first()).toBeVisible();
    await page.locator('[data-testid="lyrics-find"]').click();
    const dlg = page.locator('[data-testid="lyrics-search"]');
    await expect(dlg).toBeVisible();
    // the dialog pops in with a scale animation (account.css .dlg); measure the settled size
    await dlg.evaluate((el) => Promise.all(el.getAnimations().map((x) => x.finished)));
    expect(Math.round((await dlg.boundingBox())!.width)).toBe(448);
    await page.screenshot({ path: `${SHOTS}/lyrics-search.png` });
    await dlg.locator('[data-testid="lyrics-cand"][data-synced="line"]').click();
    await expect(dlg).toBeHidden();
    await expect(page.locator('.lyv[data-synced="line"]')).toBeVisible();
    expect((await calls(page, 'lyrics.choose')).length).toBe(1);
    await core('lyrics.setOffset', { trackId: id!, ms: 0 });
  });
});

test.describe('full player', () => {
  test('E-29 two panes at 1536x960: tabs, chips, tint layers, wavy progress, art rect', async ({ page }) => {
    const [id] = await playTracks(8, 0);
    await core('lyrics.choose', { trackId: id!, candidateId: 'kugou-word' });
    await open(page);
    await openFull(page);
    const fp = page.locator('[data-testid="full-player"]');
    await expect(fp).toHaveClass(/two/);
    await expect(page.locator('[data-testid="fp-right"]')).toBeVisible();
    const tabs = fp.getByRole('tab');
    expect(await tabs.count()).toBe(3);
    await expect(fp.getByRole('button', { name: /Karaoke/ })).toBeVisible();
    await expect(fp.locator('[data-testid="fp-progress"][data-variant="wavy"]')).toBeVisible();
    await expect(fp.locator('[data-testid="fp-output"]')).toBeVisible();
    await expect(fp.locator('[data-testid="fp-eq"]')).toBeVisible();
    // tint: both stacked layers exist; the next track cross-fades into the other one
    const bgOf = () => fp.locator('.fp-tl.on').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.getPropertyValue('--tint')));
    const before = await bgOf();
    await core('player.next');
    await expect.poll(async () => (await fp.locator('.fp-tl.on').count())).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(700);
    const after = await bgOf();
    expect(after.length).toBe(1);
    expect(after[0]).not.toBe(before[0]);
    // Tiếp theo / Liên quan tabs
    await tabs.nth(1).click();
    await expect(fp.locator('[data-testid="queue-panel"]')).toBeVisible();
    await tabs.nth(2).click();
    await expect(fp.locator('[data-testid="related-item"]').first()).toBeVisible();
    await tabs.nth(0).click();
    await page.screenshot({ path: `${SHOTS}/full-player-1536x960.png` });
    // art rect right after the transition, inside the viewport
    const art = (await fp.locator('[data-testid="player-art"]').boundingBox())!;
    expect(art.width).toBeGreaterThan(300);
    expect(art.x + art.width).toBeLessThanOrEqual(1536);
  });

  test('E-29b one pane below 960x600: the "Lời / Tiếp theo" layer; Esc closes the layer before the player', async ({ page }) => {
    await playTracks(8, 0);
    await page.setViewportSize({ width: 900, height: 700 });
    await open(page);
    await openFull(page);
    const fp = page.locator('[data-testid="full-player"]');
    await expect(fp).toHaveClass(/one/);
    await expect(page.locator('[data-testid="fp-right"]')).toBeHidden();
    await page.screenshot({ path: `${SHOTS}/full-player-900x700.png` });
    await page.locator('[data-testid="fp-layer-btn"]').click();
    await expect(page.locator('[data-testid="fp-right"]')).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/full-player-900x700-layer.png` });
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="fp-right"]')).toBeHidden();
    await expect(fp).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(fp).toBeHidden();
  });

  test('E-29c player bar -> full player round trip; L / Q inside the full player pick the tab', async ({ page }) => {
    await playTracks(8, 0);
    await open(page);
    await page.locator('[data-testid="player-art"]').first().click();
    const fp = page.locator('[data-testid="full-player"]');
    await expect(fp).toBeVisible();
    await page.waitForTimeout(550);
    await page.keyboard.press('q');
    await expect(fp.locator('[data-testid="queue-panel"]')).toBeVisible();
    await page.keyboard.press('l');
    await expect(fp.locator('[data-testid="lyrics-view"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(fp).toBeHidden();
  });
});

test.describe('bar extras', () => {
  test('E-30 volume slider, mute (M), sleep timer, output, speed, progress variants, floating bar', async ({ page }) => {
    await playTracks(8, 0);
    // the mock core is shared by every spec of a run: start from full volume, not muted (m1-foundation presses M)
    await core('player.mute', { on: false });
    await core('player.setVolume', { v: 1 });
    await open(page);
    // volume: role=slider on the bar, arrows change it, M mutes
    const vol = page.locator('[data-testid="player-bar"] [data-testid="volume-slider"]');
    await expect(vol).toBeVisible();
    await vol.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await calls(page, 'player.setVolume')).at(-1)?.v).toBeCloseTo(0.95, 2);
    await page.locator('body').click({ position: { x: 700, y: 400 } });
    await page.keyboard.press('m');
    await expect.poll(async () => (await calls(page, 'player.mute')).at(-1)?.on).toBe(true);
    await page.keyboard.press('m');
    // sleep timer menu
    await page.locator('[data-testid="sleep-btn"]').click();
    await expect(page.locator('[data-testid="pop-sleep"]')).toBeVisible();
    await page.locator('[data-testid="sleep-15"]').click();
    expect((await calls(page, 'player.sleepTimer')).at(-1)).toEqual({ minutes: 15 });
    await expect(page.locator('[data-testid="sleep-chip"]')).toContainText(/1[45]:\d\d/);
    await page.locator('[data-testid="sleep-btn"]').click();
    await expect(page.locator('[data-testid="sleep-remaining"]')).toBeVisible();
    await page.locator('[data-testid="sleep-cancel"]').click();
    expect((await calls(page, 'player.sleepTimer')).at(-1)).toEqual({ cancel: true });
    await expect(page.locator('[data-testid="sleep-chip"]')).toHaveCount(0);
    // output picker
    await page.locator('[data-testid="output-btn"]').click();
    await page.locator('[data-testid="output-item"]').first().click();
    expect((await calls(page, 'player.output.set')).length).toBe(1);
    // speed (more menu)
    await page.locator('[data-testid="more-btn"]').click();
    await page.locator('[data-testid="speed-1.5"]').click();
    expect((await calls(page, 'player.setSpeed')).at(-1)).toEqual({ speed: 1.5 });
    await expect(page.locator('[data-testid="speed-chip"]')).toContainText('1.5');
    // progress variants (the menu stays open after a speed pick)
    await page.locator('[data-testid="prog-wavy"]').click();
    await expect(page.locator('[data-testid="player-bar"] .prog[data-variant="wavy"]')).toBeVisible();
    await page.locator('[data-testid="prog-thick"]').click();
    await expect(page.locator('[data-testid="player-bar"] .prog.thick')).toBeVisible();
    // floating bar
    await page.locator('[data-testid="floating-switch"]').click();
    await expect(page.locator('[data-testid="player-bar"]')).toHaveClass(/float/);
    await page.screenshot({ path: `${SHOTS}/bar-floating-thick.png` });
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="more-btn"]').click();
    await page.locator('[data-testid="floating-switch"]').click();
    await page.locator('[data-testid="prog-line"]').click();
    await expect(page.locator('[data-testid="player-bar"]')).not.toHaveClass(/float/);
    await core('player.setSpeed', { speed: 1 });
  });

  test('E-30b medium width: volume popover with role=slider', async ({ page }) => {
    await playTracks(8, 0);
    await page.setViewportSize({ width: 1024, height: 768 });
    await open(page);
    await page.locator('[data-testid="vol-btn"]').click();
    const pop = page.locator('[data-testid="pop-vol"]');
    await expect(pop).toBeVisible();
    const sl = pop.getByRole('slider');
    await expect(sl).toBeVisible();
    expect(await sl.getAttribute('aria-valuenow')).not.toBeNull();
    await sl.click({ position: { x: 40, y: 2 } });
    await expect.poll(async () => (await calls(page, 'player.setVolume')).length).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
  });
});

test.describe('perf proxy (indicative, dev server)', () => {
  test('P-1 20 full-player open/close cycles: dropped frames per transition', async ({ page }) => {
    test.setTimeout(120_000);
    await playTracks(8, 0);
    await open(page);
    await page.evaluate(() => {
      const w = window as any;
      w.__fr = [] as number[];
      let last = 0;
      const loop = (t: number) => {
        if (w.__rec) { if (last) w.__fr.push(t - last); last = t; } else last = 0;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await page.waitForTimeout(2500); // idle prewarm of the layer
    const dropped: number[] = [];
    for (let i = 0; i < 20; i++) {
      for (const key of ['t', 'Escape']) {
        await page.evaluate(() => { (window as any).__fr = []; (window as any).__rec = true; });
        await page.keyboard.press(key);
        await page.waitForTimeout(480);
        const fr: number[] = await page.evaluate(() => { (window as any).__rec = false; return (window as any).__fr; });
        dropped.push(fr.reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0));
        await page.waitForTimeout(60);
      }
    }
    const mean = dropped.reduce((a, b) => a + b, 0) / dropped.length;
    console.log(`P-1 transitions=${dropped.length} mean dropped=${mean.toFixed(2)} max=${Math.max(...dropped)} all=${dropped.join(',')}`);
    // headless software GL is far slower than the WebView2 + GPU the budget (<= 1) targets: the web run only guards against regressions (measured 2-5 here)
    expect(mean).toBeLessThanOrEqual(8);
  });

  test('P-2 lyrics playing for 60 s: no long task, no rAF loop', async ({ page }) => {
    test.setTimeout(150_000);
    const [id] = await playTracks(3, 0);
    await core('lyrics.choose', { trackId: id!, candidateId: 'kugou-word' });
    await core('player.seek', { ms: 3000 });
    await page.addInitScript(() => {
      const w = window as any;
      w.__raf = 0;
      const orig = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => { w.__raf++; return orig(cb); };
      w.__lt = [] as number[];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__lt.push(e.duration))).observe({ type: 'longtask', buffered: true });
    });
    await open(page);
    await openFull(page);
    await expect(page.locator('.lyv[data-synced="word"]')).toBeVisible();
    await page.waitForTimeout(1500);
    const r0 = await page.evaluate(() => ({ raf: (window as any).__raf as number, lt: (window as any).__lt.length as number }));
    await page.waitForTimeout(60_000);
    const r1 = await page.evaluate(() => ({ raf: (window as any).__raf as number, lt: (window as any).__lt as number[] }));
    console.log(`P-2 rAF calls in 60 s: ${r1.raf - r0.raf}; long tasks in 60 s: ${r1.lt.length - r0.lt} (${r1.lt.slice(r0.lt).join(',')})`);
    expect(r1.raf - r0.raf).toBeLessThanOrEqual(3);
    expect(r1.lt.length - r0.lt).toBe(0);
  });
});
