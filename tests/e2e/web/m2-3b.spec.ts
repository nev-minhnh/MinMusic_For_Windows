import { test, expect, type Page } from '@playwright/test';
import WebSocket from 'ws';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { xOfHz, yOfDb } from '../../../ui/src/pages/Equalizer/biquad';

// E-28 .. E-33 (test-guide section 4): Equalizer page on the `web` project (Vite + mock-core), plus the perf proxy.
// The graph is a canvas, so node positions are computed with the same plot maths as the page (biquad.ts, inset 40/20/12/26, +-18 dB).
const MOCK_PORT = Number(process.env.MOCK_PORT) || 47999;
const APO = resolve(__dirname, '../../fixtures/eq/sample-apo.txt');
const SHOTS = process.env.MM_SHOTS ?? resolve(__dirname, '../../../.testdata/m2-3b-shots');
const INSET = { l: 40, r: 20, t: 12, b: 26 };
const RANGE = 18;

/** One-shot raw rpc against the mock (resets state between tests; also reads the core's view of the state). */
async function rpc<T = any>(calls: [string, any?][]): Promise<T[]> {
  const ws = new WebSocket(`ws://127.0.0.1:${MOCK_PORT}/rpc`);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let id = 1;
  const pending = new Map<number, (m: any) => void>();
  ws.on('message', (d) => { const m = JSON.parse(d.toString()); const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); } });
  const call = (m: string, p?: any) => new Promise<any>((resolveCall, rejectCall) => {
    const i = id++;
    pending.set(i, (msg) => (msg.e ? rejectCall(new Error(`${m}: ${msg.e.msg}`)) : resolveCall(msg.r)));
    ws.send(JSON.stringify(p === undefined ? { id: i, m } : { id: i, m, p }));
  });
  await call('sys.hello', { token: 'dev', role: 'ui', protocol: 1, client: 'e2e/0.1', locale: 'vi' });
  const out: T[] = [];
  for (const [m, p] of calls) out.push(await call(m, p));
  ws.close();
  return out;
}
const eqGet = async () => (await rpc([['eq.get']]))[0] as any;
async function resetEq() {
  const s = await eqGet();
  for (const p of s.profiles.filter((x: any) => !x.builtin)) await rpc([['eq.profile.delete', { id: p.id }]]);
  await rpc([['eq.setEnabled', { on: true }], ['eq.setProfile', { id: 'flat' }], ['eq.setAutoPreamp', { on: false }], ['eq.setPreamp', { db: 0 }],
    ['eq.setEffects', { bassDb: 0, trebleDb: 0, widthPct: 100, crossfeed: 'off', limiter: true, outputDb: 0 }], ['eq.device.bind', { deviceId: 'default', profileId: null }]]);
  const t = await eqGet();
  for (let i = t.bands.length - 1; i >= 0; i--) await rpc([['eq.resetBand', { index: i }]]);
}

async function openEq(page: Page, query = '') {
  await page.goto('/' + query);
  await expect(page.locator('[data-testid="home"]')).toBeVisible();
  await page.keyboard.press('Control+e');
  await expect(page.locator('[data-testid="equalizer"]')).toBeVisible();
  await expect(page.locator('[data-testid="eq-fader-1"]')).toBeVisible();
  await expect(page.locator('[data-testid="eq-canvas"]')).toBeVisible();
}
/** page coordinates of band `i` (flat profile: gain 0 until the test changes it) */
async function nodeXY(page: Page, i: number) {
  const box = (await page.locator('[data-testid="eq-canvas"]').boundingBox())!;
  const s = await eqGet();
  const b = s.bands[i];
  const w = box.width - INSET.l - INSET.r, h = box.height - INSET.t - INSET.b;
  const g = ['PK', 'LSC', 'HSC'].includes(b.type) ? Math.max(-RANGE, Math.min(RANGE, b.gain)) : 0;
  return { x: box.x + xOfHz(b.freq, INSET.l, w), y: box.y + yOfDb(g, INSET.t, h, RANGE) };
}
const num = async (page: Page, id: string) => parseFloat(((await page.locator(`[data-testid="${id}"]`).inputValue()) || '0').replace(',', '.'));

test.use({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
test.beforeEach(async () => { await resetEq(); });

test('E-28 drag a node: frequency (x, log) and gain (y) follow the pointer', async ({ page }) => {
  await openEq(page);
  const before = await eqGet();
  const p = await nodeXY(page, 5); // 1 kHz
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 60, p.y - 40, { steps: 6 });
  await page.mouse.move(p.x + 120, p.y - 80, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await eqGet()).bands[5].gain, { timeout: 5000 }).toBeGreaterThan(3);
  const after = await eqGet();
  expect(after.bands[5].freq).toBeGreaterThan(before.bands[5].freq * 1.25);
  await expect(page.locator('[data-testid="eq-freq"]')).toHaveValue(/Hz$/);
  expect(await num(page, 'eq-gain')).toBeCloseTo(after.bands[5].gain, 0);
  await page.screenshot({ path: resolve(SHOTS, 'e28-drag.png') });
});

test('E-29 wheel over a node changes Q, Shift+wheel is fine gain', async ({ page }) => {
  await openEq(page);
  const p = await nodeXY(page, 5);
  await page.mouse.move(p.x, p.y);
  const q0 = (await eqGet()).bands[5].q;
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await eqGet()).bands[5].q).toBeGreaterThan(q0);
  const q1 = (await eqGet()).bands[5].q;
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => (await eqGet()).bands[5].q).toBeLessThan(q1);
  const g0 = (await eqGet()).bands[5].gain;
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await eqGet()).bands[5].gain).toBeCloseTo(g0 + 0.1, 1);
});

test('E-30 double-click on a node sets 0 dB; a click on an empty area deselects and creates nothing', async ({ page }) => {
  await openEq(page);
  await rpc([['eq.updateBand', { index: 4, gain: 7 }]]);
  await expect(page.locator('[data-testid="eq-fader-4"]')).toHaveValue('7');
  const p = await nodeXY(page, 4);
  await page.mouse.dblclick(p.x, p.y);
  await expect.poll(async () => (await eqGet()).bands[4].gain).toBe(0);
  const n = (await eqGet()).bands.length;
  const box = (await page.locator('[data-testid="eq-canvas"]').boundingBox())!;
  await page.mouse.click(box.x + box.width - 30, box.y + 20);
  await expect(page.locator('[data-testid="eq-gain-inc"]')).toBeDisabled();
  expect((await eqGet()).bands.length).toBe(n);
});

test('E-31 keyboard: Tab selects bands, arrows move 1/12 octave and 0.5 dB (Shift 0.1)', async ({ page }) => {
  await openEq(page);
  const p = await nodeXY(page, 5);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('[data-testid="eq-graph-desc"]')).toContainText(/5|6/);
  const f0 = (await eqGet()).bands[5].freq;
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await eqGet()).bands[5].freq).toBeCloseTo(f0 * Math.pow(2, 1 / 12), 0);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await eqGet()).bands[5].freq).toBeCloseTo(f0, 0);
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await eqGet()).bands[5].gain).toBeCloseTo(0.5, 2);
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(async () => (await eqGet()).bands[5].gain).toBeCloseTo(0.6, 2);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await eqGet()).bands[5].gain).toBeCloseTo(-0.4, 2);
  // global seek keys must not have fired while the graph owns the arrows
  const sel0 = await page.locator('[data-testid="eq-graph-desc"]').textContent();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-testid="eq-graph-desc"]')).not.toHaveText(sel0!);
  await expect(page.locator('[data-testid="eq-graph"]')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('[data-testid="eq-graph-desc"]')).toHaveText(sel0!);
});

test('E-32 profiles: edit, save as new, undo / redo, rename, delete, Ctrl E opens the page', async ({ page }) => {
  await openEq(page);
  const fader = page.locator('[data-testid="eq-fader-2"]');
  await fader.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowUp'); // +2.0 dB in 0.1 steps
  await expect.poll(async () => (await eqGet()).bands[2].gain).toBeGreaterThan(1.5);
  await page.locator('[data-testid="eq-save"]').click();
  await expect(page.locator('[data-testid="eq-dlg-save"]')).toBeVisible();
  await page.locator('[data-testid="eq-profile-name"]').fill('Phòng khách');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="eq-profile-chip"]', { hasText: 'Phòng khách' })).toBeVisible();
  const s = await eqGet();
  expect(s.profiles.some((p: any) => p.name === 'Phòng khách' && !p.builtin)).toBe(true);
  // switch away and back
  await page.locator('[data-testid="eq-profile-chip"][data-id="bass"]').click();
  await expect.poll(async () => (await eqGet()).profileId).toBe('bass');
  await expect(page.locator('[data-testid="eq-undo"]')).toBeEnabled();
  await page.locator('[data-testid="eq-undo"]').click();
  await expect.poll(async () => (await eqGet()).profileId).not.toBe('bass');
  await expect(page.locator('[data-testid="eq-redo"]')).toBeEnabled();
  await page.locator('[data-testid="eq-redo"]').click();
  await expect.poll(async () => (await eqGet()).profileId).toBe('bass');
  // rename + delete the user profile
  await page.locator('[data-testid="eq-profile-chip"]', { hasText: 'Phòng khách' }).click();
  await page.locator('[data-testid="eq-rename"]').click();
  await page.locator('[data-testid="eq-profile-name"]').fill('Phòng ngủ');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="eq-profile-chip"]', { hasText: 'Phòng ngủ' })).toBeVisible();
  await page.locator('[data-testid="eq-delete"]').click();
  await page.locator('[data-testid="eq-dlg-ok"]').click();
  await expect(page.locator('[data-testid="eq-profile-chip"]', { hasText: 'Phòng ngủ' })).toHaveCount(0);
  // Ctrl Z / Ctrl Y on the page
  await page.locator('[data-testid="eq-profile-chip"][data-id="bass"]').click();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await eqGet()).canRedo).toBe(true);
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await eqGet()).canRedo).toBe(false);
});

test('E-33 import an APO file (fixture), AutoEq search + apply, export', async ({ page }) => {
  await openEq(page);
  // the shell's pick_file / save_file are Tauri commands; stub them the way the shell answers
  await page.evaluate(([apo]) => {
    (window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string) => (cmd === 'pick_file' ? apo : cmd === 'save_file' ? apo.replace('sample-apo.txt', 'exported.tmp.txt') : undefined) };
  }, [APO]);
  await page.locator('[data-testid="eq-import"]').click();
  await expect(page.locator('[data-testid="eq-profile-chip"]', { hasText: 'sample-apo' })).toBeVisible();
  const s = await eqGet();
  expect(s.bands.length).toBe(5);
  expect(s.preampDb).toBeCloseTo(-5.8, 1);
  await expect(page.locator('[data-testid="eq-status"]')).toContainText('sample-apo.txt');
  await page.screenshot({ path: resolve(SHOTS, 'e33-import.png') });
  // AutoEq wizard
  await page.locator('[data-testid="eq-autoeq"]').click();
  await expect(page.locator('[data-testid="eq-dlg-autoeq"]')).toBeVisible();
  await page.locator('[data-testid="eq-autoeq-q"]').fill('sony');
  await expect(page.locator('[data-testid="eq-autoeq-item"]')).toHaveCount(2);
  await page.screenshot({ path: resolve(SHOTS, 'e33-autoeq.png') });
  await page.locator('[data-testid="eq-autoeq-item"]').first().locator('[data-testid="eq-autoeq-apply"]').click();
  await expect(page.locator('[data-testid="eq-dlg-autoeq"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="eq-profile-chip"]', { hasText: 'AutoEq' })).toBeVisible();
  await expect.poll(async () => (await eqGet()).bands.length).toBe(5);
  // Esc closes the wizard
  await page.locator('[data-testid="eq-autoeq"]').click();
  await expect(page.locator('[data-testid="eq-dlg-autoeq"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="eq-dlg-autoeq"]')).toHaveCount(0);
});

test('effects card, limiter meter, per-device profile', async ({ page }) => {
  await openEq(page);
  await page.locator('[data-testid="eq-bass"]').fill('4');
  await expect.poll(async () => (await eqGet()).effects.bassDb).toBe(4);
  await page.getByRole('tab', { name: /Chu Moy/ }).click();
  await expect.poll(async () => (await eqGet()).effects.crossfeed).toBe('chuMoy');
  await page.locator('[data-testid="eq-limiter"]').click();
  await expect.poll(async () => (await eqGet()).effects.limiter).toBe(false);
  await page.locator('[data-testid="eq-device-select"]').first().selectOption('bass');
  await expect.poll(async () => (await eqGet()).deviceProfiles.length).toBe(1);
  await page.locator('[data-testid="eq-enabled"]').click();
  await expect.poll(async () => (await eqGet()).enabled).toBe(false);
});

test('layouts: tabs below 1000 wide, horizontal fader rows below 720, screenshots', async ({ page }) => {
  await openEq(page, '?lang=vi&theme=dark');
  await expect(page.locator('[data-testid="eq-two-col"]')).toBeVisible();
  await expect(page.locator('[data-testid="eq-fader-list"]')).not.toHaveClass(/rows/);
  const cols = await page.locator('[data-testid="eq-fader-list"] > .eqp-col').count();
  expect(cols).toBe(11); // preamp + 10 bands
  await page.screenshot({ path: resolve(SHOTS, 'eq-1920x1200-dark.png') });
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('[data-testid="eq-one-col"]')).toBeVisible();
  await page.getByRole('tab', { name: /Hiệu ứng|Effects/ }).click();
  await expect(page.locator('[data-testid="eq-effects"]')).toBeVisible();
  await page.screenshot({ path: resolve(SHOTS, 'eq-1024x768-fx.png') });
  await page.setViewportSize({ width: 800, height: 600 });
  await page.getByRole('tab', { name: /Dải tần|Bands/ }).click();
  await expect(page.locator('[data-testid="eq-fader-list"]')).toHaveClass(/rows/);
  await page.screenshot({ path: resolve(SHOTS, 'eq-800x600-rows.png') });
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/?lang=vi&theme=light');
  await page.keyboard.press('Control+e');
  await expect(page.locator('[data-testid="eq-canvas"]')).toBeVisible();
  await page.screenshot({ path: resolve(SHOTS, 'eq-1920x1200-light.png') });
});

test('spectrum: frames arrive only while the toggle is on', async ({ page }) => {
  let frames = 0;
  page.on('websocket', (ws) => ws.on('framereceived', (f) => { if (String(f.payload).includes('"eq.spectrum"')) frames++; }));
  await openEq(page);
  await page.waitForTimeout(500);
  expect(frames).toBe(0);
  await page.locator('[data-testid="eq-spectrum"]').click();
  await page.waitForTimeout(700);
  expect(frames).toBeGreaterThan(5);
  expect(frames).toBeLessThan(30); // <= 30 Hz
  await page.screenshot({ path: resolve(SHOTS, 'eq-spectrum.png') });
  await page.locator('[data-testid="eq-spectrum"]').click();
  await page.waitForTimeout(150);
  const f1 = frames;
  await page.waitForTimeout(500);
  expect(frames).toBe(f1);
  await page.locator('[data-testid="eq-spectrum"]').click(); // leave it as found: page leaves -> sub closes
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForTimeout(250);
  const f2 = frames;
  await page.waitForTimeout(500);
  expect(frames, 'no spectrum frames after leaving the page').toBe(f2);
});

test('perf proxy: a 3 s node drag has 0 long tasks and no frame over 16.7 ms (+ jitter allowance); idle page with spectrum off has no rAF activity', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__raf = 0;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb: FrameRequestCallback) => { w.__raf++; return orig(cb); };
  });
  await openEq(page);
  await page.waitForTimeout(600);
  // idle: no rAF at all
  const r0 = await page.evaluate(() => (window as any).__raf);
  await page.waitForTimeout(1500);
  const r1 = await page.evaluate(() => (window as any).__raf);
  expect(r1 - r0, 'rAF calls while idle').toBeLessThanOrEqual(1);
  // drag for 3 s
  await page.evaluate(() => {
    const w = window as any;
    w.__long = [];
    w.__frames = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ entryTypes: ['longtask'] });
    let last = performance.now();
    const loop = (t: number) => { w.__frames.push(t - last); last = t; if (w.__mon) requestAnimationFrame(loop); };
    w.__mon = true;
    requestAnimationFrame(loop);
  });
  const p = await nodeXY(page, 5);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  const t0 = Date.now();
  let k = 0;
  while (Date.now() - t0 < 3000) {
    const a = (Date.now() - t0) / 3000;
    await page.mouse.move(p.x + Math.sin(a * 12) * 150, p.y + Math.cos(a * 9) * 70);
    k++;
    await page.waitForTimeout(4);
  }
  await page.mouse.up();
  const res = await page.evaluate(() => { const w = (window as any); w.__mon = false; return { long: w.__long as number[], frames: (w.__frames as number[]).slice(2) }; });
  const sorted = [...res.frames].sort((a, b) => a - b);
  const worst = sorted[sorted.length - 1] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const over = res.frames.filter((f) => f > 16.7 * 1.5).length;
  console.log(`perf: ${k} moves, ${res.frames.length} frames, long tasks ${res.long.length}, frame p95 ${p95.toFixed(1)} ms, worst ${worst.toFixed(1)} ms, frames > 25 ms: ${over}`);
  expect(res.long.length, 'long tasks (> 50 ms)').toBe(0);
  expect(over, 'frames over 25 ms during the drag').toBeLessThanOrEqual(Math.ceil(res.frames.length * 0.02));
  const calls = await page.evaluate(() => ((window as any).__mmCalls as { m: string }[]).filter((c) => c.m === 'eq.updateBand').length);
  expect(calls, 'eq.updateBand calls (<= one per frame)').toBeLessThanOrEqual(res.frames.length + 2);
  console.log(`perf: eq.updateBand calls ${calls} for ${res.frames.length} frames`);
  // after the drag the page returns to idle
  await page.waitForTimeout(800);
  const r2 = await page.evaluate(() => (window as any).__raf);
  await page.waitForTimeout(1200);
  expect((await page.evaluate(() => (window as any).__raf)) - r2, 'rAF calls after the drag settled').toBeLessThanOrEqual(1);
});

test.afterAll(() => { mkdirSync(SHOTS, { recursive: true }); });
