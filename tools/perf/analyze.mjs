#!/usr/bin/env node
// Trace analyzer for MinMusic perf runs (test-guide §5 step 4).
//
//   node tools/perf/analyze.mjs <trace.json> [presentmon.csv] [--window <startTs,endTs>|auto]
//                               [--pid <rendererPid>] [--json]
//
// Window: trace timestamps in microseconds (Chromium TimeTicks). `auto` (default) uses the
// `mm-perf-start` / `mm-perf-end` user-timing marks written by run.mjs, and falls back to the
// whole trace. The renderer pid is the pid that emitted the start mark (or --pid, or the pid
// with the most non-idle compositor frames).
//
// Returns / prints:
//   { frames, dropped, droppedPct, partial, longTasks, maxLongTaskMs, eventLatencyP95, pmLongGaps, ... }
//   frames       = all top-level PipelineReporter frames except NO_UPDATE_DESIRED
//   dropped      = STATE_DROPPED + STATE_PRESENTED_PARTIAL   (`partial` is the PARTIAL share)
//   droppedPct   = dropped / frames * 100
//   longTasks    = RunTask > 50 ms on CrRendererMain
//   eventLatencyP95 = p95 of EventLatency durations (ms), null if no input events
//   pmLongGaps   = PresentMon rows with MsBetweenDisplayChange > 25 (null when no CSV)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LONG_TASK_MS = 50;
export const LONG_GAP_MS = 25;
const START_MARK = 'mm-perf-start';
const END_MARK = 'mm-perf-end';

export function loadTrace(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(raw) ? raw : raw.traceEvents || [];
}

function reporterState(e) {
  const a = e.args || {};
  // Chromium names the dict `frame_reporter`; the brief says `chrome_frame_reporter`; some
  // builds nest it under `data`. Accept all three.
  const r = a.frame_reporter || a.chrome_frame_reporter || (a.data && (a.data.frame_reporter || a.data.chrome_frame_reporter)) || a.data || {};
  return { state: r.state, host: r.layer_tree_host_id ?? 0, smooth: !!r.affects_smoothness, rep: r };
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function parsePresentMonCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) throw new Error('empty PresentMon CSV');
  const header = lines[0].split(',').map((s) => s.trim());
  const col = (...names) => {
    for (const n of names) {
      const i = header.findIndex((h) => h.toLowerCase() === n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  // PresentMon versions rename columns; map by header name and fail loudly if the needed ones are gone.
  const iGap = col('MsBetweenDisplayChange');
  if (iGap < 0) throw new Error('PresentMon CSV lacks MsBetweenDisplayChange; columns: ' + header.join(','));
  const iApp = col('Application', 'ProcessName');
  const iTimeMs = col('CPUStartQPCTime', 'CPUStartTime'); // --qpc_time_ms => ms
  const iTimeQpc = col('CPUStartQPC'); // --qpc_time => raw ticks
  const iType = col('FrameType');
  const rows = [];
  for (const l of lines.slice(1)) {
    const f = l.split(',');
    const gap = parseFloat(f[iGap]);
    rows.push({
      app: iApp >= 0 ? f[iApp] : '',
      gapMs: Number.isFinite(gap) ? gap : null,
      qpcMs: iTimeMs >= 0 && /^[\d.]+$/.test(f[iTimeMs] || '') ? parseFloat(f[iTimeMs]) : null,
      qpcTicks: iTimeQpc >= 0 ? parseFloat(f[iTimeQpc]) : null,
      type: iType >= 0 ? f[iType] : '',
    });
  }
  return { header, rows };
}

export function analyze({ events, pm = null, window: win = 'auto', pid = null } = {}) {
  const threadName = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threadName.set(e.pid + ':' + e.tid, e.args && e.args.name);

  // ---- window and renderer pid
  const startMark = events.find((e) => e.name === START_MARK);
  const endMark = events.find((e) => e.name === END_MARK);
  if (pid == null && startMark) pid = startMark.pid;
  let t0 = -Infinity, t1 = Infinity;
  if (Array.isArray(win)) [t0, t1] = win;
  else if (win === 'auto' && startMark) {
    t0 = startMark.ts;
    t1 = endMark ? endMark.ts : Infinity;
  }
  const inWin = (ts) => ts >= t0 && ts <= t1;

  // ---- frames: top-level PipelineReporter 'b' events (stage children have other names)
  let reporters = events.filter((e) => e.name === 'PipelineReporter' && e.ph === 'b');
  if (pid == null) {
    const score = new Map();
    for (const e of reporters) {
      if (reporterState(e).state === 'STATE_NO_UPDATE_DESIRED') continue;
      if (threadName.get(e.pid + ':' + e.tid) === 'CrBrowserMain') continue;
      score.set(e.pid, (score.get(e.pid) || 0) + 1);
    }
    pid = [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  reporters = reporters.filter((e) => e.pid === pid && inWin(e.ts));
  // A renderer can have several layer tree hosts; keep the one with the most real frames.
  const perHost = new Map();
  for (const e of reporters) {
    const r = reporterState(e);
    if (r.state !== 'STATE_NO_UPDATE_DESIRED') perHost.set(r.host, (perHost.get(r.host) || 0) + 1);
  }
  const mainHost = [...perHost.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const states = {};
  for (const e of reporters) {
    const r = reporterState(e);
    if (mainHost !== undefined && r.host !== mainHost) continue;
    states[r.state] = (states[r.state] || 0) + 1;
  }
  const idle = states.STATE_NO_UPDATE_DESIRED || 0;
  const all = Object.values(states).reduce((a, b) => a + b, 0);
  const frames = all - idle;
  const partial = states.STATE_PRESENTED_PARTIAL || 0;
  const dropped = (states.STATE_DROPPED || 0) + partial;
  const droppedPct = frames > 0 ? (dropped / frames) * 100 : 0;

  // ---- long tasks on the renderer main thread
  const longs = events.filter(
    (e) => e.name === 'RunTask' && e.ph === 'X' && e.pid === pid && threadName.get(e.pid + ':' + e.tid) === 'CrRendererMain' && e.dur / 1000 > LONG_TASK_MS && inWin(e.ts),
  );
  const runTaskCount = events.filter((e) => e.name === 'RunTask' && e.ph === 'X' && e.pid === pid && threadName.get(e.pid + ':' + e.tid) === 'CrRendererMain' && inWin(e.ts)).length;
  const winSec = Number.isFinite(t1 - t0) ? (t1 - t0) / 1e6 : null;

  // ---- EventLatency (async b/e pair by id2.local)
  const open = new Map();
  const lat = [];
  const byType = {};
  for (const e of events) {
    if (e.name !== 'EventLatency' || e.pid !== pid) continue;
    const id = e.id2 ? e.id2.local : e.id;
    if (e.ph === 'b') open.set(id, e);
    else if (e.ph === 'e' && open.has(id)) {
      const b = open.get(id);
      open.delete(id);
      if (!inWin(b.ts)) continue;
      const ms = (e.ts - b.ts) / 1000;
      lat.push(ms);
      const type = b.args && b.args.event_latency && b.args.event_latency.event_type;
      if (type) (byType[type] ||= []).push(ms);
    }
  }
  lat.sort((a, b) => a - b);
  const eventLatencyByType = {};
  for (const [k, v] of Object.entries(byType)) {
    v.sort((a, b) => a - b);
    eventLatencyByType[k] = { n: v.length, p95: percentile(v, 95) };
  }

  const out = {
    pid,
    windowMs: winSec == null ? null : Math.round(winSec * 1000),
    frames,
    dropped,
    droppedPct: Math.round(droppedPct * 100) / 100,
    partial,
    noUpdate: idle,
    states,
    runTasks: runTaskCount, // sanity: proves the trace saw the renderer main thread even when there are 0 frames
    longTasks: longs.length,
    maxLongTaskMs: longs.length ? Math.round(Math.max(...longs.map((e) => e.dur)) / 100) / 10 : 0,
    longTasksPerSec: winSec ? Math.round((longs.length / winSec) * 100) / 100 : null,
    eventLatencyP95: lat.length ? Math.round(percentile(lat, 95) * 10) / 10 : null,
    eventLatencyN: lat.length,
    eventLatencyByType,
    pmLongGaps: null,
  };

  if (pm) {
    let rows = pm.rows.filter((r) => r.gapMs != null);
    // Cut to the scenario window when PresentMon was run with --qpc_time_ms (same QPC clock as trace ts).
    if (Number.isFinite(t0) && Number.isFinite(t1) && rows.some((r) => r.qpcMs != null)) {
      rows = rows.filter((r) => r.qpcMs == null || (r.qpcMs * 1000 >= t0 && r.qpcMs * 1000 <= t1));
    }
    out.pmRows = rows.length;
    out.pmLongGaps = rows.filter((r) => r.gapMs > LONG_GAP_MS).length;
    out.pmMaxGapMs = rows.length ? Math.max(...rows.map((r) => r.gapMs)) : 0;
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const files = [];
  let win = 'auto', pid = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--window') {
      const v = argv[++i];
      win = v === 'auto' ? 'auto' : v.split(',').map(Number);
    } else if (argv[i] === '--pid') pid = Number(argv[++i]);
    else if (argv[i] === '--json') continue;
    else files.push(argv[i]);
  }
  if (!files.length) {
    console.error('usage: analyze.mjs <trace.json> [presentmon.csv] [--window start,end|auto] [--pid N]');
    process.exit(2);
  }
  const pm = files[1] ? parsePresentMonCsv(files[1]) : null;
  const res = analyze({ events: loadTrace(files[0]), pm, window: win, pid });
  console.log(JSON.stringify(res, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
