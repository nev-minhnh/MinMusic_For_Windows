// node --test tools/perf/analyze.test.mjs   (pure analyzer logic on synthetic traces; no browser needed)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze, parsePresentMonCsv, percentile } from './analyze.mjs';

const PID = 100, MAIN = 1, COMP = 2;
const meta = [
  { ph: 'M', name: 'thread_name', pid: PID, tid: MAIN, args: { name: 'CrRendererMain' } },
  { ph: 'M', name: 'thread_name', pid: PID, tid: COMP, args: { name: 'Compositor' } },
  { ph: 'M', name: 'thread_name', pid: 7, tid: 9, args: { name: 'CrBrowserMain' } },
];
const mark = (name, ts) => ({ name, ph: 'I', pid: PID, tid: MAIN, ts, cat: 'blink.user_timing' });
const frame = (ts, state, key = 'frame_reporter', pid = PID, host = 1) => ({
  name: 'PipelineReporter', ph: 'b', pid, tid: COMP, ts, id2: { local: '0x' + ts }, args: { [key]: { state, layer_tree_host_id: host } },
});
const child = (ts) => ({ name: 'EndActivateToSubmitCompositorFrame', ph: 'b', pid: PID, tid: COMP, ts, id2: { local: '0x' + ts }, args: {} });
const task = (ts, ms) => ({ name: 'RunTask', ph: 'X', pid: PID, tid: MAIN, ts, dur: ms * 1000 });

function build({ presented, dropped, partial, idle, key }) {
  const ev = [...meta, mark('mm-perf-start', 1000)];
  let t = 2000;
  const add = (n, s) => { for (let i = 0; i < n; i++, t += 16000) ev.push(frame(t, s, key), child(t + 10)); };
  add(presented, 'STATE_PRESENTED_ALL');
  add(dropped, 'STATE_DROPPED');
  add(partial, 'STATE_PRESENTED_PARTIAL');
  add(idle, 'STATE_NO_UPDATE_DESIRED');
  ev.push(mark('mm-perf-end', t + 1000));
  return { ev, end: t + 1000 };
}

test('dropped% = (DROPPED+PARTIAL)/(all - NO_UPDATE); stage children and other pids ignored', () => {
  const { ev } = build({ presented: 90, dropped: 6, partial: 4, idle: 50 });
  ev.push(frame(5000, 'STATE_DROPPED', 'frame_reporter', 7)); // browser process: must not count
  const r = analyze({ events: ev });
  assert.equal(r.frames, 100);
  assert.equal(r.dropped, 10);
  assert.equal(r.partial, 4);
  assert.equal(r.droppedPct, 10);
  assert.equal(r.noUpdate, 50);
});

test('state key fallbacks: chrome_frame_reporter and data', () => {
  for (const key of ['chrome_frame_reporter', 'data']) {
    const { ev } = build({ presented: 9, dropped: 1, partial: 0, idle: 0, key });
    assert.equal(analyze({ events: ev }).dropped, 1, key);
  }
});

test('all idle trace: 0 frames, 0 dropped (only NO_UPDATE_DESIRED)', () => {
  const { ev } = build({ presented: 0, dropped: 0, partial: 0, idle: 30 });
  const r = analyze({ events: ev });
  assert.deepEqual([r.frames, r.dropped, r.droppedPct, r.noUpdate], [0, 0, 0, 30]);
});

test('long tasks: only CrRendererMain RunTask > 50 ms inside the window', () => {
  const { ev } = build({ presented: 10, dropped: 0, partial: 0, idle: 0 });
  ev.push(task(3000, 120), task(4000, 51), task(5000, 50), task(6000, 10)); // 2 long (50 is not > 50)
  ev.push({ ...task(7000, 300), tid: COMP }); // wrong thread
  ev.push(task(1, 400)); // before the window
  const r = analyze({ events: ev });
  assert.equal(r.longTasks, 2);
  assert.equal(r.maxLongTaskMs, 120);
});

test('EventLatency p95 and window cut', () => {
  const { ev } = build({ presented: 10, dropped: 0, partial: 0, idle: 0 });
  for (let i = 0; i < 20; i++) {
    const id2 = { local: '0xe' + i };
    ev.push({ name: 'EventLatency', ph: 'b', pid: PID, tid: COMP, ts: 3000 + i * 100, id2, args: { event_latency: { event_type: 'MOUSE_WHEEL' } } });
    ev.push({ name: 'EventLatency', ph: 'e', pid: PID, tid: COMP, ts: 3000 + i * 100 + (i === 19 ? 80000 : 10000), id2, args: {} });
  }
  const r = analyze({ events: ev });
  assert.equal(r.eventLatencyN, 20);
  assert.equal(r.eventLatencyP95, 10); // nearest rank: ceil(.95*20)=19th of 20 sorted values; the single 80 ms outlier is the max, not p95
  ev.push({ name: 'EventLatency', ph: 'b', pid: PID, tid: COMP, ts: 3500, id2: { local: '0xz' }, args: {} }, { name: 'EventLatency', ph: 'e', pid: PID, tid: COMP, ts: 83500, id2: { local: '0xz' }, args: {} });
  assert.equal(analyze({ events: ev }).eventLatencyP95, 80); // 21 samples: p95 = 20th = 80
});

test('percentile nearest rank', () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([], 95), null);
});

test('PresentMon CSV: header-mapped, NA ignored, long gaps > 25 ms, window cut by CPUStartQPCTime', () => {
  const f = path.join(os.tmpdir(), 'mm-pm-test.csv');
  fs.writeFileSync(f, [
    'Application,ProcessID,CPUStartQPCTime,FrameTime,DisplayedTime,MsBetweenDisplayChange',
    'msedgewebview2.exe,1,0.5,16,16,16.7',   // before window (ts 500 us)
    'msedgewebview2.exe,1,3.0,16,16,16.7',
    'msedgewebview2.exe,1,4.0,16,33,33.4',   // duplicate frame: long gap
    'msedgewebview2.exe,1,5.0,16,NA,NA',
    'msedgewebview2.exe,1,6.0,16,50,50.1',   // long gap
    'msedgewebview2.exe,1,900.0,16,50,50.1', // after window
  ].join('\r\n'));
  const pm = parsePresentMonCsv(f);
  const { ev } = build({ presented: 5, dropped: 0, partial: 0, idle: 0 }); // window 1000..~81000 us
  const r = analyze({ events: ev, pm });
  assert.equal(r.pmLongGaps, 2);
  assert.equal(r.pmRows, 3);
  fs.writeFileSync(f, 'Application,Foo\nx,1\n');
  assert.throws(() => parsePresentMonCsv(f), /MsBetweenDisplayChange/);
});
