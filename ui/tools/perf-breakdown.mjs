// Where did the frame time go? Reads Chrome traces written by perf-trace.mjs and prints, per trace,
// inside the mm-perf-start/end window:
//   - PipelineReporter states of the renderer (dropped = DROPPED + PRESENTED_PARTIAL, as in milestones.md)
//     and the drop reasons
//   - renderer main thread: long tasks and total ms of Layout / Style / Paint / PrePaint / Layerize / Commit / script
//   - raster workers (CompositorTileWorker): RasterTask / image decode ms
//   - GPU process (CrGpuMain, VizCompositorThread) top events by total ms
//   node tools/perf-breakdown.mjs <trace.json>...
import fs from "node:fs";

const MAIN_NAMES = ["Layout", "UpdateLayoutTree", "Paint", "PrePaint", "Layerize", "Commit", "FunctionCall", "EvaluateScript", "TimerFire", "EventDispatch", "HitTest", "Decode Image", "ImageDecodeTask", "ParseHTML", "ScrollLayer", "UpdateLayer", "IntersectionObserverController::computeIntersections", "ResizeObserverController::BroadcastObservations"];
for (const file of process.argv.slice(2)) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const ev = Array.isArray(raw) ? raw : raw.traceEvents;
  const tn = new Map(), pn = new Map();
  for (const e of ev) if (e.ph === "M") { if (e.name === "thread_name") tn.set(e.pid + ":" + e.tid, e.args.name); if (e.name === "process_name") pn.set(e.pid, e.args.name); }
  const s = ev.find((e) => e.name === "mm-perf-start"), en = ev.find((e) => e.name === "mm-perf-end");
  const pid = s?.pid;
  const t0 = s?.ts ?? -Infinity, t1 = en?.ts ?? Infinity;
  const inW = (e) => e.ts >= t0 && e.ts <= t1;
  const thr = (e) => tn.get(e.pid + ":" + e.tid) ?? "?";
  // frames
  const rep = ev.filter((e) => e.name === "PipelineReporter" && e.ph === "b" && e.pid === pid && inW(e));
  const st = {}, reasons = {};
  let smoothDropped = 0;
  const R = (e) => e.args?.frame_reporter ?? e.args?.chrome_frame_reporter ?? e.args?.data ?? {};
  const hosts = new Map();
  for (const e of rep) { const r = R(e); if (r.state !== "STATE_NO_UPDATE_DESIRED") hosts.set(r.layer_tree_host_id ?? 0, (hosts.get(r.layer_tree_host_id ?? 0) ?? 0) + 1); }
  const host = [...hosts].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const e of rep) {
    const r = R(e);
    if ((r.layer_tree_host_id ?? 0) !== host) continue;
    st[r.state] = (st[r.state] ?? 0) + 1;
    if (r.state === "STATE_DROPPED" || r.state === "STATE_PRESENTED_PARTIAL") { if (r.affects_smoothness) smoothDropped++; const k = `${r.state.slice(6)}:${r.frame_type ?? "?"}:${r.scroll_state ?? ""}`; reasons[k] = (reasons[k] ?? 0) + 1; }
  }
  const frames = Object.entries(st).filter(([k]) => k !== "STATE_NO_UPDATE_DESIRED").reduce((a, [, v]) => a + v, 0);
  const dropped = (st.STATE_DROPPED ?? 0) + (st.STATE_PRESENTED_PARTIAL ?? 0);
  // sums
  const sum = (filter) => { const m = {}; for (const e of ev) if (e.ph === "X" && e.dur && inW(e) && filter(e)) m[e.name] = (m[e.name] ?? 0) + e.dur / 1000; return m; };
  const top = (m, n = 8) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", ");
  const main = sum((e) => e.pid === pid && thr(e) === "CrRendererMain");
  const longs = ev.filter((e) => e.ph === "X" && e.name === "RunTask" && e.pid === pid && thr(e) === "CrRendererMain" && inW(e) && e.dur > 50000).map((e) => (e.dur / 1000).toFixed(0));
  const maxTask = Math.max(0, ...ev.filter((e) => e.ph === "X" && e.name === "RunTask" && e.pid === pid && thr(e) === "CrRendererMain" && inW(e)).map((e) => e.dur / 1000));
  const raster = sum((e) => e.pid === pid && /CompositorTileWorker/.test(thr(e)));
  const comp = sum((e) => e.pid === pid && thr(e) === "Compositor");
  const gpuPid = [...pn].find(([, n]) => /GPU/i.test(n))?.[0];
  const gpuMain = sum((e) => e.pid === gpuPid && thr(e) === "CrGpuMain");
  const viz = sum((e) => e.pid === gpuPid && /VizCompositor/.test(thr(e)));
  const winMs = (t1 - t0) / 1000;
  console.log(`\n== ${file.split(/[\\/]/).pop()}  window ${winMs.toFixed(0)} ms`);
  console.log(`frames ${frames} dropped ${dropped} (${frames ? ((dropped / frames) * 100).toFixed(1) : 0}%)  states ${JSON.stringify(st)}  affects_smoothness ${smoothDropped}`);
  if (Object.keys(reasons).length) console.log(`drop reasons ${JSON.stringify(reasons)}`);
  console.log(`main: maxTask ${maxTask.toFixed(0)} ms, long>50 [${longs.join(",")}] | ${MAIN_NAMES.filter((k) => main[k]).map((k) => `${k} ${main[k].toFixed(0)}`).join(", ")} | RunTask total ${(main.RunTask ?? 0).toFixed(0)}`);
  console.log(`raster: ${top(raster, 6)}`);
  console.log(`compositor: ${top(comp, 5)}`);
  console.log(`gpu main: ${top(gpuMain, 6)}`);
  console.log(`viz: ${top(viz, 6)}`);
}
