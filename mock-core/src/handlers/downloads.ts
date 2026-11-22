// Mock of api.md 3.9: download.* and storage.*, the `downloads` topic. Stateful per MockState: a queue that really progresses
// (2 downloads at a time, progress events <= 2 Hz per download and <= 4 Hz in total), deterministic failures and the folder rules.
//
// Deterministic rules the UI tests rely on:
//  - a track whose id hashes to a multiple of 5 fails ONCE at 50 % with error "network"; `download.retry` then succeeds;
//  - setFolder: a path containing "missing" or "nonexistent" -> {ok:false,error:"missing"}, containing "readonly" -> "not_writable";
//    a folder containing "offline" is saved but reports folderOk:false (an unplugged drive); null = the default folder;
//  - the downloaded set is the dataset's `download:"downloaded"` tracks (about 10 %), so counts and library.window agree.
import type { DownloadQueueItem, DownloadSummary, LocalList, PlayContext, SortSpec, StorageUsage, Track } from "@minmusic/protocol";
import type { HandlerModule, MockState } from "../state.ts";
import { bad, hash32, isObj, notFound, reqBool, reqInt, reqStr, reqStrArr } from "../util.ts";

export const DEFAULT_FOLDER = "C:\\Users\\Test\\Music\\MinMusic";
const TICK_MS = 250;
const STEP = 0.0625; // 16 ticks = 4 s per track
const CONCURRENCY = 2;
const MB = 1024 * 1024;

type Item = { id: string; state: "queued" | "downloading" | "failed"; progress: number; error?: string; attempts: number };
type Dl = {
  folder: string | null;
  paused: boolean;
  queue: Item[];
  batchTotal: number;
  batchDone: number;
  timer: ReturnType<typeof setInterval> | null;
  tick: number;
  usage: Record<"songCache" | "imageCache" | "videoCache" | "animatedArt", number>;
};

const stores = new WeakMap<MockState, Dl>();
function dl(st: MockState): Dl {
  let d = stores.get(st);
  if (!d) {
    d = { folder: null, paused: false, queue: [], batchTotal: 0, batchDone: 0, timer: null, tick: 0, usage: { songCache: 412 * MB, imageCache: 96 * MB, videoCache: 0, animatedArt: 18 * MB } };
    stores.set(st, d);
  }
  return d;
}

/** Estimated file size: kbps x duration, lossless at 900 kbps. */
export function sizeOf(t: Track): number {
  const kbps = t.quality?.kbps ?? (t.quality?.lossless ? 900 : 160);
  return Math.round(((t.durationMs ?? 200_000) / 1000) * kbps * 125);
}
const failsOnce = (id: string) => hash32(id) % 5 === 0;
const trackOf = (st: MockState, id: string): Track => {
  const t = st.registry.get(id);
  if (!t) throw notFound(`track ${id}`);
  return t;
};
const downloaded = (st: MockState) => st.dataset.songs.filter((s) => s.download === "downloaded");

function summary(st: MockState): DownloadSummary {
  const d = dl(st);
  const done = downloaded(st);
  const byLabel = new Map<string, number>();
  let bytes = 0;
  for (const t of done) {
    const label = t.quality?.label ?? "128";
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
    bytes += sizeOf(t);
  }
  const running = d.queue.find((i) => i.state === "downloading") ?? d.queue.find((i) => i.state === "queued");
  const total = d.batchTotal;
  return {
    count: done.length,
    bytes,
    byQuality: [...byLabel].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    folder: d.folder ?? DEFAULT_FOLDER,
    folderOk: !(d.folder ?? "").toLowerCase().includes("offline"),
    active: total > 0 ? { done: d.batchDone, total, ...(running ? { label: st.registry.get(running.id)?.title } : {}) } : { done: 0, total: 0 },
    paused: d.paused,
  };
}
const emitSummary = (st: MockState) => st.emit("downloads", "download.summary", summary(st));

function setState(st: MockState, id: string, s: "none" | "queued" | "downloading" | "downloaded" | "failed") {
  const t = st.registry.get(id);
  if (t) t.download = s === "none" ? undefined : s;
}

function enqueue(st: MockState, ids: string[]) {
  const d = dl(st);
  let added = 0;
  for (const id of ids) {
    const t = trackOf(st, id);
    if (t.download === "downloaded" || d.queue.some((i) => i.id === id)) continue;
    d.queue.push({ id, state: "queued", progress: 0, attempts: 0 });
    setState(st, id, "queued");
    added++;
  }
  if (!added) return;
  d.batchTotal += added;
  st.bumpLibrary(["songs"]);
  emitSummary(st);
  ensureTimer(st);
}

function ensureTimer(st: MockState) {
  const d = dl(st);
  if (d.timer) return;
  d.timer = setInterval(() => step(st), TICK_MS);
  d.timer.unref?.();
}

function step(st: MockState) {
  const d = dl(st);
  if (!d.queue.some((i) => i.state !== "failed")) {
    // nothing left to run: end of the batch
    if (d.timer) clearInterval(d.timer);
    d.timer = null;
    d.batchDone = 0;
    d.batchTotal = d.queue.length; // failed items stay in the batch
    emitSummary(st);
    return;
  }
  if (d.paused) return;
  d.tick++;
  const live = d.queue.filter((i) => i.state === "downloading");
  for (const i of d.queue) {
    if (live.length >= CONCURRENCY) break;
    if (i.state === "queued") { i.state = "downloading"; setState(st, i.id, "downloading"); live.push(i); st.emit("downloads", "download.progress", { id: i.id, state: "downloading", progress: i.progress }); }
  }
  let finished = false;
  for (const i of live) {
    i.progress = Math.min(1, i.progress + STEP);
    const t = trackOf(st, i.id);
    if (i.attempts === 0 && failsOnce(i.id) && i.progress >= 0.5) {
      i.state = "failed";
      i.error = "network";
      setState(st, i.id, "failed");
      st.emit("downloads", "download.progress", { id: i.id, state: "failed", progress: i.progress });
      emitSummary(st);
      continue;
    }
    if (i.progress >= 1) {
      d.queue = d.queue.filter((x) => x !== i);
      d.batchDone++;
      setState(st, i.id, "downloaded");
      st.emit("downloads", "download.progress", { id: i.id, state: "downloaded", progress: 1, bytes: sizeOf(t) });
      finished = true;
    } else if (d.tick % 2 === 0) {
      // <= 2 Hz per download
      st.emit("downloads", "download.progress", { id: i.id, state: "downloading", progress: i.progress, bytes: Math.round(sizeOf(t) * i.progress) });
    }
  }
  if (finished) { st.bumpLibrary(["downloaded", "songs"]); emitSummary(st); }
}

function contextTracks(st: MockState, c: PlayContext): Track[] {
  if (c.kind === "tracks") return c.ids.map((id) => trackOf(st, id));
  if (c.kind === "userAlbum") return st.userAlbumTracks(String(c.id));
  if (c.kind === "album") {
    const a = st.dataset.albums.find((x) => x.id === c.id);
    if (a) return a.trackIds.map((id) => trackOf(st, id));
    if (c.id && c.id === st.albumFixture.album?.id) return st.albumFixture.tracks as Track[];
    throw notFound(`album ${String(c.id)}`);
  }
  // playlist, artist, radio, library: a deterministic handful
  return st.relatedTracks(st.registry.get(String(c.id)), 8);
}

function dropFromQueue(st: MockState, pred: (i: Item) => boolean) {
  const d = dl(st);
  const gone = d.queue.filter(pred);
  d.queue = d.queue.filter((i) => !pred(i));
  for (const i of gone) setState(st, i.id, "none");
  d.batchTotal = Math.max(d.queue.length, d.batchTotal - gone.length);
  if (!d.queue.length) { d.batchTotal = 0; d.batchDone = 0; }
  if (gone.length) st.bumpLibrary(["songs"]);
  return gone.length;
}

function usage(st: MockState): StorageUsage {
  const d = dl(st);
  return { ...d.usage, downloads: summary(st).bytes, limits: { songCache: 1024 * MB, imageCache: 512 * MB, videoCache: 2048 * MB } };
}

export const handlers: HandlerModule["handlers"] = {
  "download.summary": (_p, { st }) => summary(st),
  "download.queue": (_p, { st }) => ({
    items: dl(st).queue.map((i): DownloadQueueItem => {
      const t = trackOf(st, i.id);
      return { ...t, state: i.state, progress: i.progress, bytes: Math.round(sizeOf(t) * i.progress), ...(i.error ? { error: i.error } : {}) };
    }),
  }),
  "download.window": (p, { st }) => {
    if (!isObj(p)) throw bad("params required");
    const offset = reqInt(p, "offset", 0);
    const limit = reqInt(p, "limit", 1, 200);
    if (!isObj(p.sort) || typeof p.sort.by !== "string" || typeof p.sort.desc !== "boolean") throw bad("sort required");
    if (p.list !== "downloaded") throw bad("list must be downloaded");
    const items = st.listItems("downloaded" as LocalList, p.sort as SortSpec, p.filter);
    return { total: items.length, revision: st.lib.revision, offset, items: items.slice(offset, offset + limit) };
  },
  "download.tracks": (p, { st }) => {
    const ids = reqStrArr(p, "ids");
    ids.forEach((id) => trackOf(st, id));
    enqueue(st, ids);
    return {};
  },
  "download.context": (p, { st }) => {
    if (!isObj(p) || !isObj(p.context) || typeof p.context.kind !== "string") throw bad("context required");
    enqueue(st, contextTracks(st, p.context as PlayContext).map((t) => t.id));
    return {};
  },
  "download.cancel": (p, { st }) => {
    if (!isObj(p)) throw bad("params required");
    const all = p.all === undefined ? false : reqBool(p, "all");
    const ids = p.ids === undefined ? [] : reqStrArr(p, "ids");
    if (!all && !ids.length) throw bad("ids or all required");
    dropFromQueue(st, (i) => all || ids.includes(i.id));
    emitSummary(st);
    return {};
  },
  "download.pause": (_p, { st }) => { dl(st).paused = true; emitSummary(st); return {}; },
  "download.resume": (_p, { st }) => { dl(st).paused = false; emitSummary(st); return {}; },
  "download.retry": (p, { st }) => {
    const d = dl(st);
    const ids = isObj(p) && p.ids !== undefined ? reqStrArr(p, "ids") : null;
    let n = 0;
    for (const i of d.queue) if (i.state === "failed" && (!ids || ids.includes(i.id))) { i.state = "queued"; i.progress = 0; i.error = undefined; i.attempts++; setState(st, i.id, "queued"); n++; }
    if (n) { emitSummary(st); ensureTimer(st); }
    return {};
  },
  "download.remove": (p, { st }) => {
    const ids = reqStrArr(p, "ids");
    if (p.deleteFiles !== true) throw bad("deleteFiles:true required");
    const set = new Set(ids);
    dropFromQueue(st, (i) => set.has(i.id));
    for (const id of ids) { const t = st.registry.get(id); if (t?.download === "downloaded") setState(st, id, "none"); }
    st.bumpLibrary(["downloaded", "songs"]);
    emitSummary(st);
    return {};
  },
  "download.setFolder": (p, { st }) => {
    if (!isObj(p) || !("path" in p) || (p.path !== null && (typeof p.path !== "string" || p.path === ""))) throw bad("path: string | null required");
    const path = p.path as string | null;
    const low = (path ?? "").toLowerCase();
    if (low.includes("missing") || low.includes("nonexistent")) return { ok: false, error: "missing" };
    if (low.includes("readonly")) return { ok: false, error: "not_writable" };
    dl(st).folder = path;
    emitSummary(st);
    return { ok: true };
  },
  "download.saveTo": (p, { st }) => {
    const ids = reqStrArr(p, "ids");
    reqStr(p, "path");
    for (const id of ids) if (trackOf(st, id).download !== "downloaded") throw bad(`track ${id} is not downloaded`);
    return {};
  },
  "storage.usage": (_p, { st }) => usage(st),
  "storage.clear": (p, { st }) => {
    const what = reqStr(p, "what");
    const d = dl(st);
    if (!(what in d.usage)) throw bad(`unknown cache ${what}`);
    d.usage[what as keyof Dl["usage"]] = 0;
    return {};
  },
};

export const topics: HandlerModule["topics"] = {
  downloads: ({ st }) => summary(st),
};
