#!/usr/bin/env node
// Scenario driver (test-guide §5). Attaches over CDP to the running app (or to Edge for calibration),
// records a Chromium trace around each scenario run, optionally captures PresentMon, and analyses.
//
//   node tools/perf/run.mjs --endpoint http://127.0.0.1:9222 --scenario P1,P2|all|CAL --size 1920|4k
//        [--runs 5] [--out docs/perf] [--trace-dir .testdata/<id>/perf] [--pm <PresentMon.exe> --pm-process msedgewebview2.exe]
//        [--url <page url>]   (CAL / web target: navigate the attached page first)
//        [--jank 0|1]         (CAL: use the deliberately janky page variant; default 1 for CAL)
//        [--cal-kind jank|clean|idle]
//
// OS-level input: wheel notches and hover glides go through tools/perf/bin/sendinput.exe (SendInput),
// so the compositor input path is exercised. Clicks and keys use CDP Input.dispatch* (acceptable for
// P3/P4/P8 because latency is measured from the event timestamp).
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, loadTrace, parsePresentMonCsv } from './analyze.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SENDINPUT = path.join(HERE, 'bin', 'sendinput.exe');

export const TRACE_CATEGORIES =
  'benchmark,graphics.pipeline,cc,viz,gpu,input,devtools.timeline,disabled-by-default-devtools.timeline.frame,blink.user_timing,' +
  // RunTask (long-task detection) lives in this category; the spec list omits it but the analyzer needs it.
  'disabled-by-default-devtools.timeline';

// Selector table. The data-testid names are the M0-C contract; the fallbacks are tried in order.
export const SEL = {
  home: '[data-testid="home"]',
  list: '[data-testid="songs-list"]',
  row: '[data-testid="song-row"]',
  tile: '[data-testid="qp-tile"], [data-testid="card"]',
  playerBar: '[data-testid="player-bar"]',
  playerArt: '[data-testid="player-art"]',
  fullPlayer: '[data-testid="full-player"]',
  navBack: '[data-testid="nav-back"]',
  navHome: '[data-testid="nav-home"]',
  navLibrary: '[data-testid="nav-library"], [data-testid="nav-songs"]',
};

// Pass thresholds, milestones.md. `per` = per transition (P3/P4).
export const THRESHOLDS = {
  1920: {
    P1: { droppedPct: 0.5, gaps: 0 }, P2: { droppedPct: 0.5 }, P3: { perTransition: 1, gaps: 0 }, P4: { perTransition: 1 },
    P5: { dropped: 0 }, P6: { droppedPct: 5, maxFrameMs: 50 }, P7: { longTasks: 0 }, P8: { latencyP95: 50 },
  },
  '4k': {
    P1: { droppedPct: 1, gaps: 1 }, P2: { droppedPct: 1 }, P3: { perTransition: 1, gaps: 2 }, P4: { perTransition: 2 },
    P5: { droppedPct: 0.5 }, P6: { droppedPct: 8, maxFrameMs: 66 }, P7: { longTasks: 0 }, P8: { latencyP95: 66 },
  },
};

let OPT = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const o = { runs: 5, size: '1920', out: path.join(REPO, 'docs', 'perf'), jank: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  o.runs = Number(o.runs);
  return o;
}

// ---------------------------------------------------------------- helpers
async function pickPage(browser) {
  for (let i = 0; i < 40; i++) {
    for (const ctx of browser.contexts()) {
      const pages = ctx.pages().filter((p) => !/#\/mini/.test(p.url()) && !/^devtools:/.test(p.url()) && (OPT.url || p.url() !== 'about:blank'));
      if (pages.length) return pages[0];
    }
    await sleep(250);
  }
  throw new Error('no main page found on the CDP endpoint');
}

function runSendInput(args) {
  if (!fs.existsSync(SENDINPUT)) throw new Error('missing ' + SENDINPUT + ' (cd tools/perf/sendinput; cargo build --release; copy to bin/)');
  const r = spawnSync(SENDINPUT, args.map(String), { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('sendinput failed: ' + (r.stderr || r.stdout));
  return JSON.parse(r.stdout.trim());
}

// Move the real cursor to client coords (cx,cy), self-calibrating the window->screen offset from the
// mouse event Chromium actually receives (screenX-clientX), so frames/borders/DPI do not matter.
async function placeCursor(page, cx, cy) {
  await page.bringToFront().catch(() => {});
  await sleep(200);
  const info = await page.evaluate(() => ({ sx: window.screenX, sy: window.screenY, ow: outerWidth, oh: outerHeight, iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio }));
  const b = (info.ow - info.iw) / 2;
  let ox = info.sx + b, oy = info.sy + (info.oh - info.ih) - b; // first guess of the viewport origin in DIPs
  await page.evaluate(() => {
    window.__mmMouse = null;
    window.addEventListener('mousemove', (e) => (window.__mmMouse = { cx: e.clientX, cy: e.clientY, sx: e.screenX, sy: e.screenY }), { capture: true });
  });
  for (let i = 0; i < 3; i++) {
    runSendInput(['move', '--x', Math.round((ox + cx) * info.dpr), '--y', Math.round((oy + cy) * info.dpr)]);
    await sleep(150);
    const m = await page.evaluate(() => window.__mmMouse);
    if (!m) continue;
    ox = m.sx - m.cx; // exact origin from the received event
    oy = m.sy - m.cy;
    if (Math.abs(m.cx - cx) <= 2 && Math.abs(m.cy - cy) <= 2) return { dpr: info.dpr, ox, oy, ok: true };
  }
  const m = await page.evaluate(() => window.__mmMouse);
  if (!m) throw new Error('OS mouse move never reached the page (window occluded or not under the cursor?)');
  return { dpr: info.dpr, ox, oy, ok: Math.abs(m.cx - cx) <= 6 && Math.abs(m.cy - cy) <= 6 };
}

async function centerOf(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error('selector not visible: ' + selector);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

// OS input needs an unlocked interactive desktop. When the session is locked (or the window is
// occluded) SendInput cannot reach the page; unless --os-input require is given we fall back to CDP
// Input.dispatchMouseEvent and record it in the result (`input: "cdp-fallback"`).
let osInputAvailable = true;

async function osWheel(page, selector, notches, delta = -120, interval = 200) {
  const c = await centerOf(page, selector);
  if (osInputAvailable) {
    try {
      const cal = await placeCursor(page, c.x, c.y);
      const r = runSendInput(['wheel', '--x', Math.round((cal.ox + c.x) * cal.dpr), '--y', Math.round((cal.oy + c.y) * cal.dpr), '--notches', notches, '--delta', delta, '--interval', interval]);
      return { ...r, input: 'sendinput', cursorOk: cal.ok };
    } catch (e) {
      if (OPT.osInput === 'require') throw e;
      osInputAvailable = false;
      console.error('[warn] OS input unavailable (' + e.message + '); falling back to CDP mouseWheel');
    }
  }
  const sess = await page.context().newCDPSession(page);
  const first = Date.now();
  for (let i = 0; i < notches; i++) {
    await sess.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: -delta });
    if (i + 1 < notches) await sleep(interval);
  }
  await sess.detach().catch(() => {});
  return { firstMs: first, lastMs: Date.now(), notches, input: 'cdp-fallback' };
}

async function click(page, selector) {
  const c = await centerOf(page, selector);
  await page.mouse.click(c.x, c.y);
}

async function clickFirst(page, selector, nth = 0) {
  const loc = page.locator(selector).nth(nth);
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const box = await loc.boundingBox();
  if (!box) throw new Error('not visible: ' + selector);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function goHome(page) {
  const nav = page.locator(SEL.navHome).first();
  if (await nav.count()) await nav.click();
  await page.locator(SEL.home).first().waitFor({ timeout: 10000 }).catch(() => {});
}

async function goLibrary(page) {
  if (await page.locator(SEL.list).count()) return;
  const nav = page.locator(SEL.navLibrary).first();
  if (await nav.count()) await nav.click();
  await page.locator(SEL.list).first().waitFor({ timeout: 10000 });
  await page.locator(SEL.row).first().waitFor({ timeout: 10000 });
}

// ---------------------------------------------------------------- scenarios
// Each scenario: { setup(page), drive(page, ctx) -> extra info, transitions? }
const SCENARIOS = {
  // 40 wheel notches over 8 s on the 5,000-row songs list (also the CAL driver).
  P1: { setup: goLibrary, drive: (p) => osWheel(p, SEL.list, 40, -120, 200) },
  // Home top -> bottom -> top: 20 notches down, 20 up.
  P2: {
    setup: goHome,
    drive: async (p) => {
      const a = await osWheel(p, SEL.home, 20, -120, 200);
      await osWheel(p, SEL.home, 20, 120, 200);
      return a;
    },
  },
  // Home -> Album -> Artist -> back x2, 20 transitions (10 push + 10 pop). Back via Alt+Left.
  P3: {
    setup: goHome,
    transitions: 20,
    drive: async (p) => {
      for (let i = 0; i < 10; i++) {
        await clickFirst(p, SEL.tile, i % 4);
        await sleep(450);
        await p.keyboard.press('Alt+ArrowLeft');
        await sleep(450);
      }
    },
  },
  // Player bar <-> full player, 20 open/close cycles (40 transitions).
  P4: {
    setup: goHome,
    transitions: 40,
    drive: async (p) => {
      for (let i = 0; i < 20; i++) {
        await click(p, SEL.playerArt);
        await p.locator(SEL.fullPlayer).first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
        await sleep(450);
        await p.keyboard.press('Escape');
        await sleep(450);
      }
    },
  },
  // Hover sweep over 30 rows (real cursor glide).
  P5: {
    setup: goLibrary,
    drive: async (p) => {
      const rows = p.locator(SEL.row);
      const a = await rows.nth(1).boundingBox();
      const b = await rows.nth(Math.min(30, (await rows.count()) - 1)).boundingBox();
      const ax = a.x + a.width / 2, ay = a.y + a.height / 2, bx = b.x + b.width / 2, by = b.y + b.height / 2;
      if (osInputAvailable) {
        try {
          const cal = await placeCursor(p, ax, ay);
          const o = (x, y) => [Math.round((cal.ox + x) * cal.dpr), Math.round((cal.oy + y) * cal.dpr)];
          const [x0, y0] = o(ax, ay), [x1, y1] = o(bx, by);
          return { ...runSendInput(['move', '--x', x0, '--y', y0, '--to-x', x1, '--to-y', y1, '--steps', 90, '--interval', 40]), input: 'sendinput' };
        } catch (e) {
          if (OPT.osInput === 'require') throw e;
          osInputAvailable = false;
          console.error('[warn] OS input unavailable (' + e.message + '); falling back to CDP mouseMoved');
        }
      }
      for (let i = 0; i <= 90; i++) {
        await p.mouse.move(ax + ((bx - ax) * i) / 90, ay + ((by - ay) * i) / 90);
        await sleep(40);
      }
      return { input: 'cdp-fallback' };
    },
  },
  // Resize drag across 1199/840 breakpoints, 5 s. Uses the e2e command in the real app, CDP bounds on Edge.
  P6: {
    setup: goHome,
    drive: async (p) => {
      const tauri = await p.evaluate(() => !!(window.__TAURI__ && window.__TAURI__.core));
      const h = 900;
      const sizes = [];
      for (let i = 0; i <= 50; i++) sizes.push(Math.round(1300 - (1300 - 780) * (i / 50))); // 1300 -> 780 crosses 1200 and 840
      const sess = tauri ? null : await p.context().newCDPSession(p);
      const win = sess ? (await sess.send('Browser.getWindowForTarget')).windowId : 0;
      for (const w of sizes) {
        if (tauri) await p.evaluate(([w, h]) => window.__TAURI__.core.invoke('test_set_window_size', { width: w, height: h }), [w, h]);
        else await sess.send('Browser.setWindowBounds', { windowId: win, bounds: { width: w, height: h } });
        await sleep(100);
      }
    },
  },
  // Click -> first changed frame (nav and play): 20 CDP clicks, latency from EventLatency.
  P8: {
    setup: goHome,
    latencyTypes: /MOUSE_PRESSED|MOUSE_RELEASED|GESTURE_TAP|KEY/,
    drive: async (p) => {
      for (let i = 0; i < 10; i++) {
        await clickFirst(p, SEL.tile, i % 4);
        await sleep(500);
        await p.keyboard.press('Alt+ArrowLeft');
        await sleep(500);
      }
    },
  },
  // CAL: the P1 driver; the page variant (janky or clean) decides the expected outcome.
  CAL: { setup: async () => {}, drive: (p) => osWheel(p, SEL.list, 20, -120, 200) },
  // CAL-IDLE: no input for 5 s on the idle page.
  'CAL-IDLE': { setup: async () => {}, drive: async () => { await sleep(5000); } },
};

// ---------------------------------------------------------------- tracing + PresentMon
function startPresentMon(exe, proc, csv) {
  if (!exe) return null;
  const child = spawn(exe, ['--process_name', proc, '--output_file', csv, '--qpc_time_ms', '--no_console_stats', '--session_name', 'mmperf', '--stop_existing_session'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  child.stdout.on('data', (d) => (err += d));
  child.on('exit', () => {});
  child.getErr = () => err;
  return child;
}

async function stopPresentMon(child) {
  if (!child) return;
  if (child.exitCode == null) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']); // only the process we started
    await sleep(300);
  }
}

// ---------------------------------------------------------------- run
async function measure(page, bs, name, opt, runIdx) {
  const sc = SCENARIOS[name];
  await sc.setup(page);
  await sleep(500);
  const tag = `${name}-${opt.size}-r${runIdx}`;
  fs.mkdirSync(opt.traceDir, { recursive: true });
  const csv = path.join(opt.traceDir, `${tag}.presentmon.csv`);
  const pm = startPresentMon(opt.pm, opt.pmProcess || 'msedgewebview2.exe', csv);
  let pmErr = null;
  if (pm) {
    await sleep(2000);
    if (pm.exitCode != null) pmErr = `PresentMon exited ${pm.exitCode}: ${pm.getErr().trim().slice(0, 300)}`;
  }
  const complete = new Promise((resolve) => bs.once('Tracing.tracingComplete', resolve));
  await bs.send('Tracing.start', { categories: TRACE_CATEGORIES, transferMode: 'ReturnAsStream', streamFormat: 'json' });
  await sleep(300);
  await page.evaluate(() => performance.mark('mm-perf-start'));
  let info = {};
  let err = null;
  try {
    info = (await sc.drive(page)) || {};
  } catch (e) {
    err = String(e.message || e);
  }
  await sleep(400);
  await page.evaluate(() => performance.mark('mm-perf-end'));
  await bs.send('Tracing.end');
  const { stream } = await complete;
  let text = '';
  for (;;) {
    const c = await bs.send('IO.read', { handle: stream });
    text += c.data;
    if (c.eof) break;
  }
  await bs.send('IO.close', { handle: stream });
  await stopPresentMon(pm);
  const tracePath = path.join(opt.traceDir, `${tag}.trace.json`);
  fs.writeFileSync(tracePath, text);
  if (err) return { run: runIdx, error: err, tracePath };
  const events = JSON.parse(text).traceEvents;
  let pmParsed = null;
  if (pm && fs.existsSync(csv)) {
    try {
      pmParsed = parsePresentMonCsv(csv);
    } catch (e) {
      pmErr = pmErr || String(e.message);
    }
  } else if (pm) pmErr = pmErr || 'no PresentMon CSV written';
  const res = analyze({ events, pm: pmParsed });
  // Optional latency-type filter (P8).
  if (sc.latencyTypes) {
    const ps = Object.entries(res.eventLatencyByType).filter(([k]) => sc.latencyTypes.test(k)).map(([, v]) => v.p95);
    res.eventLatencyP95 = ps.length ? Math.max(...ps) : null;
  }
  if (sc.transitions) {
    res.transitions = sc.transitions;
    res.droppedPerTransition = Math.round((res.dropped / sc.transitions) * 100) / 100;
  }
  return { run: runIdx, ...res, info, pmError: pmErr, tracePath, csvPath: pm ? csv : null };
}

function verdict(name, size, w) {
  const t = (THRESHOLDS[size] || {})[name];
  if (!t || w == null || w.error) return null;
  const why = [];
  if (t.droppedPct != null && w.droppedPct > t.droppedPct) why.push(`dropped ${w.droppedPct}% > ${t.droppedPct}%`);
  if (t.dropped != null && w.dropped > t.dropped) why.push(`dropped ${w.dropped} > ${t.dropped}`);
  if (t.perTransition != null && w.droppedPerTransition > t.perTransition) why.push(`dropped/transition ${w.droppedPerTransition} > ${t.perTransition}`);
  if (t.gaps != null && w.pmLongGaps != null && w.pmLongGaps > t.gaps) why.push(`long gaps ${w.pmLongGaps} > ${t.gaps}`);
  if (t.latencyP95 != null && w.eventLatencyP95 != null && w.eventLatencyP95 > t.latencyP95) why.push(`latency p95 ${w.eventLatencyP95} > ${t.latencyP95}`);
  if (w.longTasks > 0 && name !== 'P6') why.push(`${w.longTasks} long task(s)`);
  return why.length ? 'FAIL: ' + why.join('; ') : 'PASS';
}

// Calibration verdicts (test-guide §5 step 5).
//   jank : >= 1 long task per second of window and dropped > 0
//   clean: 0 long tasks (dropped % is reported, and compared with the jank run by perf-trace.ps1)
//   idle : 0 long tasks and no dropped frames (NO_UPDATE_DESIRED does not count)
function calVerdict(kind, runs) {
  if (!runs.length) return 'FAIL: no usable run';
  const why = [];
  runs.forEach((w, i) => {
    const sec = Math.floor((w.windowMs || 0) / 1000);
    const tag = `run${w.run ?? i + 1}: `;
    if (kind === 'jank') {
      if (w.longTasks < sec) why.push(`${tag}longTasks ${w.longTasks} < ${sec} (1/s)`);
      if (!(w.dropped > 0)) why.push(`${tag}dropped == 0`);
    } else if (kind === 'clean' || kind === 'idle') {
      if (w.longTasks !== 0) why.push(`${tag}longTasks ${w.longTasks} != 0`);
      if (kind === 'idle' && w.dropped !== 0) why.push(`${tag}dropped ${w.dropped} != 0`);
    }
  });
  if (!['jank', 'clean', 'idle'].includes(kind)) return 'n/a (no --cal-kind)';
  return why.length ? 'FAIL: ' + why.join('; ') : 'PASS';
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  OPT = opt;
  if (!opt.endpoint || !opt.scenario) {
    console.error('usage: run.mjs --endpoint http://127.0.0.1:PORT --scenario P1,..|all|CAL [--size 1920|4k] [--runs N] [--out dir] [--trace-dir dir] [--pm exe] [--url page]');
    process.exit(2);
  }
  opt.traceDir = opt.traceDir || path.join(REPO, '.testdata', 'perf-' + Date.now());
  opt.size = String(opt.size);
  const names = opt.scenario === 'all' ? ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P8'] : opt.scenario.split(',').map((s) => s.trim().toUpperCase());
  for (const n of names) if (!SCENARIOS[n]) throw new Error('unknown scenario ' + n);

  const browser = await chromium.connectOverCDP(opt.endpoint);
  const page = await pickPage(browser);
  if (opt.url) await page.goto(opt.url);
  const bs = await browser.newBrowserCDPSession();
  const results = {};
  for (const name of names) {
    const runs = [];
    for (let w = 0; w < (Number(opt.warmup) || 0); w++) {
      await measure(page, bs, name, { ...opt, traceDir: path.join(opt.traceDir, 'warmup') }, 0); // discarded
    }
    for (let i = 1; i <= opt.runs; i++) {
      const r = await measure(page, bs, name, opt, i);
      runs.push(r);
      console.error(`[${name} ${opt.size} run ${i}/${opt.runs}] ` + (r.error ? 'ERROR ' + r.error : `frames=${r.frames} dropped=${r.dropped} (${r.droppedPct}%) longTasks=${r.longTasks} maxLong=${r.maxLongTaskMs}ms latP95=${r.eventLatencyP95} pmGaps=${r.pmLongGaps}`));
    }
    const ok = runs.filter((r) => !r.error);
    // "worst" = the run with the highest dropped% (ties: more long tasks), as the acceptance rule says.
    const worst = ok.length ? [...ok].sort((a, b) => b.droppedPct - a.droppedPct || b.longTasks - a.longTasks || (b.pmLongGaps || 0) - (a.pmLongGaps || 0))[0] : null;
    results[name] = {
      scenario: name,
      size: opt.size,
      runs,
      worst,
      medianDroppedPct: median(ok.map((r) => r.droppedPct)),
      medianLongTasks: median(ok.map((r) => r.longTasks)),
      verdict: name.startsWith('CAL') ? calVerdict(opt.calKind, ok) : verdict(name, opt.size, worst),
    };
  }
  fs.mkdirSync(opt.out, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const outFile = path.join(opt.out, `${date}-${names.join('+')}${opt.tag ? '-' + opt.tag : ''}-${opt.size}.json`.replace(/[^\w.+-]/g, '_'));
  const viewport = await page.evaluate(() => ({ innerWidth, innerHeight, dpr: devicePixelRatio, screenW: screen.width, screenH: screen.height })).catch(() => null);
  const payload = { date, size: opt.size, tag: opt.tag || null, endpoint: opt.endpoint, viewport, osInput: osInputAvailable ? 'sendinput' : 'cdp-fallback', presentMon: !!opt.pm, categories: TRACE_CATEGORIES, results };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ outFile, summary: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { verdict: v.verdict, worst: v.worst && { frames: v.worst.frames, dropped: v.worst.dropped, droppedPct: v.worst.droppedPct, longTasks: v.worst.longTasks, maxLongTaskMs: v.worst.maxLongTaskMs, pmLongGaps: v.worst.pmLongGaps, latP95: v.worst.eventLatencyP95 }, medianDroppedPct: v.medianDroppedPct }])) }, null, 2));
  await browser.close().catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
