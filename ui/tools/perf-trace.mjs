// Realistic frame-pacing probe for the UI in Playwright Edge (headed), with optional Chrome traces.
//
//   node tools/perf-trace.mjs <url> --size=hidpi|lodpi [--trace=<dir>] [--runs=1] [--only=a,b]
//
// hidpi = 1536x960 CSS at DPR 2.5: --force-device-scale-factor=2.5 plus a 1536x960 viewport at the same DPR,
//         so raster and present sizes are real 3840x2400 (no emulated scale-down).
// --raf=0 drops the rAF probe (it forces a main frame every vsync and inflates PRESENTED_PARTIAL).
// lodpi = 1920x1200 CSS at DPR 1 (--force-device-scale-factor=1).
// Wheel input goes through CDP Input.dispatchMouseEvent(mouseWheel), i.e. real wheel notches that the
// compositor smooth-scrolls, not page.mouse.wheel bursts. Scenarios:
//   wheel      40 notches of 100 px, 60-120 ms apart (human cadence), down then 10 back up
//   flick      2 flicks of 12 notches 10 ms apart, 600 ms apart (fast spin of the wheel)
//   wheelS     like wheel, but every notch is a 100 px synthetic mouse scroll gesture at 800 px/s (animated,
//              like Chromium wheel smooth scrolling); flickS = 2 gestures of 1600 px at 5000 px/s
//   stress     old perf.mjs test: page.mouse.wheel(0,400) every 16 ms x60
//   end        End key then Home key
//   fp1        first open of the full player, then close
//   fpN        5 more open/close pairs (warm)
// Per scenario: rAF drops (> 20 ms), > 33 ms, max frame, long tasks; with --trace also the
// PipelineReporter drop rate and a main / raster / GPU time breakdown (tools/perf-breakdown.mjs).
import { chromium } from "@playwright/test";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const url = process.argv[2] ?? "http://127.0.0.1:4173/";
const opt = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const size = opt("size", "hidpi");
const traceDir = opt("trace", "");
const runs = Number(opt("runs", "1"));
const only = opt("only", "") ? opt("only", "").split(",") : null;
const CATS = [
  "toplevel", "blink.user_timing", "devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame",
  "viz", "cc", "gpu", "benchmark", "blink", "latencyInfo", "input", "disabled-by-default-devtools.timeline.invalidationTracking",
].join(",");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function cpuSnap() { return os.cpus().map((c) => c.times); }
function cpuPct(a, b) {
  let idle = 0, tot = 0;
  b.forEach((t, i) => { const p = a[i]; const d = (k) => t[k] - p[k]; idle += d("idle"); tot += d("user") + d("nice") + d("sys") + d("irq") + d("idle"); });
  return tot ? Math.round((1 - idle / tot) * 100) : 0;
}
function locked() {
  try { return /LogonUI|LockApp/i.test(execSync('tasklist /FI "IMAGENAME eq LogonUI.exe" /NH', { encoding: "utf8" })) ? "LOCKED" : "unlocked"; } catch { return "?"; }
}

const args = size === "hidpi" ? ["--force-device-scale-factor=2.5", "--window-size=1536,1060"] : ["--force-device-scale-factor=1", "--window-size=1920,1300"];
const browser = await chromium.launch({ channel: "msedge", headless: false, args });
const results = [];
for (let run = 0; run < runs; run++) {
  const ctx = await browser.newContext(size === "hidpi" ? { viewport: { width: 1536, height: 960 }, deviceScaleFactor: 2.5 } : { viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(url);
  await page.waitForSelector('[data-testid="home"]');
  const vp = await page.evaluate(() => `${innerWidth}x${innerHeight}@${devicePixelRatio}`);
  console.log(`# ${size} run ${run + 1}: viewport ${vp}, session ${locked()}`);
  await page.evaluate((raf) => {
    window.__m = { frames: [], long: 0, on: false };
    if (!raf) return; // --raf=0: no rAF probe, so PipelineReporter sees only the app's own frames
    new PerformanceObserver((l) => l.getEntries().forEach(() => window.__m.on && window.__m.long++)).observe({ entryTypes: ["longtask"] });
    let last = performance.now();
    const loop = (t) => { if (window.__m.on) window.__m.frames.push(t - last); last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }, opt("raf", "1") !== "0");
  const W = await page.evaluate(() => innerWidth), H = await page.evaluate(() => innerHeight);
  const notch = (dy, x = W / 2, y = H / 2) => cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy });

  const measure = async (label, fn) => {
    if (only && !only.some((o) => label.startsWith(o))) return;
    const tfile = traceDir ? path.join(traceDir, `${size}-r${run + 1}-${label}.json`) : null;
    if (tfile) { await browser.startTracing(page, { categories: CATS.split(",") }); await sleep(200); }
    const c0 = cpuSnap();
    await page.evaluate(() => { performance.mark("mm-perf-start"); window.__m.frames = []; window.__m.long = 0; window.__m.on = true; });
    const extra = (await fn()) ?? {};
    const r = await page.evaluate(() => {
      performance.mark("mm-perf-end");
      window.__m.on = false;
      const f = window.__m.frames.slice(1);
      return { n: f.length, d: f.filter((x) => x > 20).length, d33: f.filter((x) => x > 33).length, max: Math.max(0, ...f), long: window.__m.long };
    });
    const cpu = cpuPct(c0, cpuSnap());
    if (tfile) { await sleep(150); fs.writeFileSync(tfile, await browser.stopTracing()); }
    const row = { size, run: run + 1, label, ...r, pct: +((r.d / Math.max(1, r.n)) * 100).toFixed(1), cpu, ...extra, trace: tfile };
    results.push(row);
    console.log(`${size} ${label.padEnd(8)} frames=${r.n} dropped=${r.d} (${row.pct}%) >33ms=${r.d33} max=${r.max.toFixed(1)}ms long=${r.long} cpu=${cpu}%` + (extra.note ? ` ${extra.note}` : ""));
  };

  await page.click('[data-testid="nav-library"]');
  await page.waitForSelector('[data-testid="songs-list"]');
  await sleep(800);
  await page.mouse.move(W / 2, H / 2);
  await measure("wheel", async () => {
    for (let i = 0; i < 40; i++) { await notch(100); await sleep(60 + rnd() * 60); }
    for (let i = 0; i < 10; i++) { await notch(-100); await sleep(60 + rnd() * 60); }
    await sleep(400);
  });
  await measure("flick", async () => {
    for (let k = 0; k < 2; k++) { for (let i = 0; i < 12; i++) { await notch(100); await sleep(10); } await sleep(600); }
    await sleep(300);
  });
  // CDP mouseWheel notches land as instant 100 px jumps (no wheel smooth-scroll animation). The S variants
  // animate each notch like Chromium's wheel smooth scroll, via synthetic mouse scroll gestures (not awaited,
  // so notches overlap the way fast real notches do).
  const gesture = (dy, speed) => cdp.send("Input.synthesizeScrollGesture", { x: W / 2, y: H / 2, yDistance: -dy, speed, gestureSourceType: "mouse", preventFling: true }).catch(() => {});
  await measure("wheelS", async () => {
    seed = 777;
    for (let i = 0; i < 40; i++) { gesture(100, 800); await sleep(60 + rnd() * 60); }
    for (let i = 0; i < 10; i++) { gesture(-100, 800); await sleep(60 + rnd() * 60); }
    await sleep(600);
  });
  await measure("flickS", async () => {
    for (let k = 0; k < 2; k++) { await gesture(1600, 5000); await sleep(500); }
    await sleep(300);
  });
  await measure("stress", async () => {
    for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, 400); await sleep(16); }
    await sleep(300);
  });
  await measure("end", async () => {
    await page.keyboard.press("End"); await sleep(900);
    await page.keyboard.press("Home"); await sleep(900);
  });
  const openClose = async () => {
    await page.click('[data-testid="player-art"]'); await sleep(700);
    await page.keyboard.press("Escape"); await sleep(700);
  };
  await measure("fp1", openClose);
  await measure("fpN", async () => { for (let i = 0; i < 5; i++) await openClose(); return { note: "5 open+close" }; });
  await ctx.close();
}
await browser.close();
const out = opt("json", "");
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));


