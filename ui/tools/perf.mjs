// Frame pacing probe in Edge: wheel scroll of the 5,000-row table, page navigation, player open/close.
// Counts frames via rAF deltas (> 20 ms = dropped at 60 Hz) and long tasks (> 50 ms).
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://127.0.0.1:5173/";
const sizes = [
  { name: "1536x960@2.5", width: 1536, height: 960, dpr: 2.5 },
  { name: "1920x1200@1", width: 1920, height: 1200, dpr: 1 },
];
const browser = await chromium.launch({ channel: "msedge", headless: process.env.HEADED ? false : true });
for (const s of sizes) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.waitForSelector('[data-testid="home"]');
  await page.evaluate(() => {
    window.__m = { frames: [], long: 0, on: false };
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__m.on && window.__m.long++)).observe({ entryTypes: ["longtask"] });
    let last = performance.now();
    const loop = (t) => { if (window.__m.on) window.__m.frames.push(t - last); last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  const measure = async (label, fn) => {
    await page.evaluate(() => { window.__m.frames = []; window.__m.long = 0; window.__m.on = true; });
    await fn();
    const r = await page.evaluate(() => { window.__m.on = false; const f = window.__m.frames.slice(1); return { n: f.length, d: f.filter((x) => x > 20).length, d33: f.filter((x) => x > 33).length, max: Math.max(...f), long: window.__m.long }; });
    console.log(s.name, label.padEnd(18), `frames=${r.n} dropped(>20ms)=${r.d} (${((r.d / r.n) * 100).toFixed(1)}%) >33ms=${r.d33} max=${r.max.toFixed(1)}ms longtasks=${r.long}`);
  };
  await measure("nav home->library", async () => { await page.click('[data-testid="nav-library"]'); await page.waitForTimeout(700); });
  await page.mouse.move(s.width / 2, s.height / 2);
  await measure("wheel scroll 5k", async () => { for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(16); } await page.waitForTimeout(300); });
  await measure("End key", async () => { await page.keyboard.press("End"); await page.waitForTimeout(900); });
  console.log(s.name, "last row", await page.evaluate(() => document.querySelector('.pg:not(.hid) [data-testid="song-row"]:last-of-type')?.dataset.index));
  await measure("open full player", async () => { await page.click('[data-testid="player-art"]'); await page.waitForTimeout(700); });
  await measure("close full player", async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(700); });
  await measure("back", async () => { await page.keyboard.press("Alt+ArrowLeft"); await page.waitForTimeout(600); });
  await ctx.close();
}
await browser.close();
