import { batch, createSignal, onCleanup, getOwner, type Accessor } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { DownloadQueueItem, DownloadSummary, FilterSpec, LibraryWindowResult, SortSpec, StorageUsage, Track } from "@minmusic/protocol";
import { client, devBuild } from "../lib/core";
import { inTauri } from "../lib/tauri";
import { locale } from "../i18n";
import { confirm } from "../dialogs/Confirm";
import { toast } from "../toast";
import { t } from "../i18n";

// ---------------------------------------------------------------- pure helpers (unit tested)

/** Bytes as "412 MB" / "6,2 GB" (1 decimal from MB up, locale decimal separator). */
export function fmtBytes(n: number, loc: string = locale()): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const nf = new Intl.NumberFormat(loc, { maximumFractionDigits: i >= 2 ? 1 : 0 });
  return `${nf.format(v)} ${units[i]}`;
}

export type QualityBar = { label: string; count: number; /** share of all downloads, 0..1: the bar's scaleX */ share: number; lossless: boolean };
const LOSSLESS = /^(flac|lossless|alac|wav)/i;
/** Distribution bars: bars are the share of the total (scaleX), largest first, the tail beyond `max` folds into one "other" bar. */
export function qualityBars(by: { label: string; count: number }[], max = 4, otherLabel = "…"): QualityBar[] {
  const total = by.reduce((a, q) => a + Math.max(0, q.count), 0);
  if (total <= 0) return [];
  const sorted = by.filter((q) => q.count > 0).sort((a, b) => b.count - a.count);
  const head = sorted.slice(0, max);
  const tail = sorted.slice(max).reduce((a, q) => a + q.count, 0);
  const out: QualityBar[] = head.map((q) => ({ label: q.label, count: q.count, share: q.count / total, lossless: LOSSLESS.test(q.label) }));
  if (tail > 0) out.push({ label: otherLabel, count: tail, share: tail / total, lossless: false });
  return out;
}

/** done/total of the active batch as a scaleX value, clamped to 0..1 */
export const batchRatio = (a: { done: number; total: number }): number => (a.total > 0 ? Math.min(1, Math.max(0, a.done / a.total)) : 0);

/** Estimated size of a source option for a track: kbps x duration (lossless without kbps: 900 kbps). */
export function estimateBytes(q: { kbps?: number; lossless?: boolean } | undefined, durMs: number | undefined): number {
  const kbps = q?.kbps ?? (q?.lossless ? 900 : 160);
  return Math.round(((durMs ?? 200_000) / 1000) * kbps * 125);
}

export type ProgressEvent = { id: string; state: "queued" | "downloading" | "downloaded" | "failed" | "none"; progress: number; bytes?: number };

/**
 * Coalesces `download.progress` for rendering: the latest value per id is applied at most every `gapMs` (default 500 ms = 2 Hz),
 * all of one flush in a single batch. State changes (anything but "downloading") bypass the delay: they change the layout.
 */
export function createProgressCoalescer(applyProgress: (items: ProgressEvent[]) => void, applyState: (e: ProgressEvent) => void, gapMs = 500) {
  const pending = new Map<string, ProgressEvent>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = -Infinity;
  const flush = () => {
    timer = null;
    last = Date.now();
    if (!pending.size) return;
    const items = [...pending.values()];
    pending.clear();
    applyProgress(items);
  };
  return {
    push(e: ProgressEvent) {
      if (e.state !== "downloading") {
        pending.delete(e.id);
        applyState(e);
        return;
      }
      pending.set(e.id, e);
      if (timer) return;
      const wait = Math.max(0, gapMs - (Date.now() - last));
      timer = setTimeout(flush, wait);
    },
    flush,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
    /** number of ids waiting for the next flush */
    size: () => pending.size,
  };
}

// ---------------------------------------------------------------- quality default (remembered by the download menu)
const QKEY = "mm.dl.quality";
const readQ = (): string => {
  try {
    return localStorage.getItem(QKEY) || "best";
  } catch {
    return "best";
  }
};
const [quality, setQualitySig] = createSignal(readQ());
/** "best" (default: the best the source offers, original format, no re-encode) or a quality label such as "FLAC", "320". */
export const downloadQuality = quality;
export function setDownloadQuality(q: string) {
  setQualitySig(q);
  try {
    localStorage.setItem(QKEY, q);
  } catch {
    /* storage can be blocked */
  }
}
export const QUALITY_CHOICES = ["best", "FLAC", "Lossless", "320", "256", "AAC 256", "Opus 160", "AAC 160", "128"] as const;

// ---------------------------------------------------------------- live state: summary + queue
export type QItem = Track & { state: DownloadQueueItem["state"]; progress: number; bytes?: number; error?: string };

const [summary, setSummary] = createSignal<DownloadSummary | null>(null);
export { summary as downloadSummary };
/** bumped whenever the downloaded set may have changed (count/bytes of a summary): windows refetch */
const [downloadedRev, setDownloadedRev] = createSignal(0);
export { downloadedRev };

const [q, setQ] = createStore<{ ids: string[]; by: Record<string, QItem> }>({ ids: [], by: {} });
export const queueIds = () => q.ids;
/** fine-grained: reading `.progress` of one item re-runs only what reads it */
export const queueItem = (id: string): QItem | undefined => q.by[id];
export const queueCount = () => q.ids.length;
export const failedCount = () => q.ids.reduce((n, id) => n + (q.by[id]?.state === "failed" ? 1 : 0), 0);
const [queueLoaded, setQueueLoaded] = createSignal(false);
export { queueLoaded };

function applyQueue(items: DownloadQueueItem[]) {
  batch(() => {
    setQ(
      produce((s) => {
        const next: Record<string, QItem> = {};
        for (const it of items) {
          const prev = s.by[it.id];
          // keep the object identity so a row keeps its DOM; new progress never goes backwards inside one attempt
          next[it.id] = prev && prev.state === it.state && prev.progress > it.progress ? { ...it, progress: prev.progress } : (it as QItem);
        }
        s.ids = items.map((i) => i.id);
        s.by = next;
      }),
    );
    setQueueLoaded(true);
  });
}

let qTimer = 0;
export function refreshQueue(now = false) {
  clearTimeout(qTimer);
  const run = () => void client.call<{ items: DownloadQueueItem[] }>("download.queue").then((r) => applyQueue(r.items)).catch(() => {});
  if (now) run();
  else qTimer = window.setTimeout(run, 200);
}

const coalescer = createProgressCoalescer(
  (items) =>
    batch(() => {
      for (const e of items) {
        if (!q.by[e.id]) continue;
        setQ("by", e.id, { progress: e.progress, state: e.state === "downloading" ? "downloading" : q.by[e.id]!.state, ...(e.bytes !== undefined ? { bytes: e.bytes } : {}) });
      }
    }),
  (e) => {
    const known = q.by[e.id];
    if (!known) return refreshQueue();
    if (e.state === "downloaded" || e.state === "none") {
      batch(() => setQ(produce((s) => {
        s.ids = s.ids.filter((x) => x !== e.id);
        delete s.by[e.id];
      })));
      return;
    }
    batch(() => setQ("by", e.id, { state: e.state, progress: e.progress, ...(e.bytes !== undefined ? { bytes: e.bytes } : {}) }));
    if (e.state === "failed") refreshQueue(); // the error text comes with the queue
  },
  500,
);

let started = false;
let lastKey = "";
/** One `downloads` topic subscription for the whole app (idempotent). Call from any page or component that shows downloads. */
export function initDownloads() {
  if (started) return;
  started = true;
  client.call<DownloadSummary>("download.summary").then(onSummary).catch(() => {});
  refreshQueue(true);
  client.sub("downloads", {}, (name, data) => {
    if (name === "downloads.snapshot" || name === "download.summary") onSummary(data as DownloadSummary);
    else if (name === "download.progress") coalescer.push(data as ProgressEvent);
  });
}

function onSummary(s: DownloadSummary) {
  const key = `${s.count}|${s.bytes}`;
  batch(() => {
    setSummary(s);
    if (key !== lastKey) {
      lastKey = key;
      setDownloadedRev((n) => n + 1);
    }
  });
  // the batch changed (items added, cancelled, retried): the queue list follows
  refreshQueue();
}

/** test seams */
export const __applyQueue = applyQueue;
export const __pushProgress = (e: ProgressEvent) => coalescer.push(e);
/** test seam: reset module state between unit tests */
export function __resetDownloads() {
  started = false;
  lastKey = "";
  coalescer.dispose();
  setSummary(null);
  setQ({ ids: [], by: {} });
}

// ---------------------------------------------------------------- windowed "Đã tải" list (download.window)
export const DL_CHUNK = 100;
/** Chunked cache over `download.window`, same shape as createWindowStore (state/library.ts) and refetched when the downloaded set changes. */
export function createDownloadedStore(sort0: SortSpec, filter0?: FilterSpec) {
  const chunks = new Map<number, [Accessor<Track[] | undefined>, (v: Track[] | undefined) => void]>();
  const inflight = new Set<number>();
  const [total, setTotal] = createSignal(0);
  const [sort, setSort] = createSignal(sort0);
  const [filter, setFilter] = createSignal(filter0);
  let epoch = 0;
  let range: [number, number] = [0, DL_CHUNK];
  const slot = (c: number) => {
    let s = chunks.get(c);
    if (!s) {
      const [get, set] = createSignal<Track[] | undefined>(undefined);
      chunks.set(c, (s = [get, (v) => set(() => v)]));
    }
    return s;
  };
  const chunksOf = (a: number, b: number) => {
    const out: number[] = [];
    for (let c = Math.floor(a / DL_CHUNK); c <= Math.floor(Math.max(a, b - 1) / DL_CHUNK); c++) out.push(c);
    return out;
  };
  const fetchChunk = (c: number) => {
    if (inflight.has(c)) return;
    inflight.add(c);
    const e = epoch;
    client
      .call<LibraryWindowResult>("download.window", { list: "downloaded", sort: sort(), filter: filter(), offset: c * DL_CHUNK, limit: DL_CHUNK })
      .then((r) => {
        if (e !== epoch) return;
        setTotal(r.total);
        slot(c)[1](r.items as Track[]);
      })
      .catch(() => {})
      .finally(() => inflight.delete(c));
  };
  const refetchVisible = (dropOthers: boolean) => {
    epoch++;
    inflight.clear();
    const vis = new Set(chunksOf(range[0], range[1]));
    chunks.forEach(([, set], c) => {
      if (dropOthers && !vis.has(c)) set(undefined);
    });
    vis.forEach(fetchChunk);
  };
  return {
    total,
    sort,
    filter,
    track: (i: number): Track | undefined => slot(Math.floor(i / DL_CHUNK))[0]()?.[i % DL_CHUNK],
    ensure(a: number, b: number) {
      range = [a, b];
      for (const c of chunksOf(a, b)) if (slot(c)[0]() === undefined) fetchChunk(c);
    },
    /** the downloaded set changed: visible chunks refetch in place (no flash), the rest are dropped */
    invalidate: () => refetchVisible(true),
    setSort(s: SortSpec) {
      setSort(s);
      chunks.forEach(([, set]) => set(undefined));
      refetchVisible(false);
    },
    setFilter(f: FilterSpec | undefined) {
      setFilter(f);
      chunks.forEach(([, set]) => set(undefined));
      refetchVisible(false);
    },
  };
}

// ---------------------------------------------------------------- actions
const fail = () => toast({ i18n: "w2_error_generic", level: "error" });
const call = (m: string, p?: unknown) => client.call(m, p);

export const pauseDownloads = () => call("download.pause").catch(fail);
export const resumeDownloads = () => call("download.resume").catch(fail);
export const togglePause = () => (summary()?.paused ? resumeDownloads() : pauseDownloads());
export const retryFailed = () => call("download.retry", {}).catch(fail);
export const retryOne = (id: string) => call("download.retry", { ids: [id] }).catch(fail);
export const cancelOne = (id: string) => call("download.cancel", { ids: [id] }).catch(fail);
export async function cancelAll(): Promise<boolean> {
  if (!(await confirm({ title: t("w2_dlx_cancel_all_title"), body: t("w2_dlx_cancel_all_body"), danger: true, okLabel: t("w2_dlx_cancel_all") }))) return false;
  await call("download.cancel", { all: true }).catch(fail);
  return true;
}
/** Remove downloaded files (confirm, deleteFiles:true: api.md 3.9). */
export async function removeDownloads(ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  if (!(await confirm({ title: t("w2_dlx_remove_title", ids.length), body: t("w2_dlx_remove_body"), danger: true, okLabel: t("w2_dlx_remove") }))) return false;
  await call("download.remove", { ids, deleteFiles: true }).catch(fail);
  return true;
}

/**
 * The native folder dialog (Tauri plugin). A plain browser has no dialog: dev/e2e builds may answer through `window.__mmPickFolder`
 * (test seam, like __mmMock), anything else gets null.
 */
export async function pickFolder(title?: string): Promise<string | null> {
  const seam = devBuild ? (window as any).__mmPickFolder : undefined;
  if (typeof seam === "function") return (await seam(title)) ?? null;
  if (!inTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const p = await open({ directory: true, multiple: false, title });
  return typeof p === "string" ? p : null;
}

export type FolderResult = { ok: boolean; error?: "not_writable" | "missing" };
/** download.setFolder; null = default folder. Failures are returned, the caller shows them inline or as a toast. */
export async function setDownloadFolder(path: string | null): Promise<FolderResult> {
  try {
    const r = await client.call<FolderResult>("download.setFolder", { path });
    if (r.ok) client.call<DownloadSummary>("download.summary").then(onSummary).catch(() => {});
    return r;
  } catch {
    fail();
    return { ok: false };
  }
}
export const folderErrorText = (e: FolderResult["error"]) => (e === "not_writable" ? t("w2_dlx_err_not_writable") : e === "missing" ? t("w2_dlx_err_missing") : t("w2_error_generic"));

/** Pick a folder and set it. Returns the outcome (null when the dialog was cancelled). */
export async function chooseFolder(): Promise<FolderResult | null> {
  const p = await pickFolder(t("w2_dlx_pick_folder"));
  return p ? setDownloadFolder(p) : null;
}
/** "Lưu bản sao…": pick a folder, then export copies of the downloaded files there. */
export async function saveCopies(ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  const p = await pickFolder(t("w2_dlx_save_to"));
  if (!p) return false;
  try {
    await client.call("download.saveTo", { ids, path: p });
    toast({ text: t("w2_dlx_saved_to", ids.length, p) });
    return true;
  } catch {
    fail();
    return false;
  }
}

// ---------------------------------------------------------------- storage (Settings > Bộ nhớ)
const [usage, setUsage] = createSignal<StorageUsage | null>(null);
export { usage as storageUsage };
export const refreshUsage = () => client.call<StorageUsage>("storage.usage").then(setUsage).catch(() => {});
export type CacheKind = "songCache" | "imageCache" | "videoCache" | "animatedArt";
// literal t() calls, so the string scanner (tools/gen-strings.mjs) sees every key
const CLEAR_BODY: Record<CacheKind, () => string> = {
  songCache: () => t("w2_dlx_clear_body_songCache"),
  imageCache: () => t("w2_dlx_clear_body_imageCache"),
  videoCache: () => t("w2_dlx_clear_body_videoCache"),
  animatedArt: () => t("w2_dlx_clear_body_animatedArt"),
};
export const CACHE_NAME: Record<CacheKind | "downloads", () => string> = {
  songCache: () => t("w2_dlx_c_songCache"),
  imageCache: () => t("w2_dlx_c_imageCache"),
  videoCache: () => t("w2_dlx_c_videoCache"),
  animatedArt: () => t("w2_dlx_c_animatedArt"),
  downloads: () => t("w2_dlx_c_downloads"),
};
export async function clearCache(what: CacheKind): Promise<boolean> {
  if (!(await confirm({ title: t("w2_dlx_clear_title"), body: CLEAR_BODY[what](), danger: true, okLabel: t("w2_dlx_clear") }))) return false;
  await client.call("storage.clear", { what }).catch(fail);
  await refreshUsage();
  return true;
}
/** a bar's scaleX: used / limit when the cache has a limit, else its share of the whole */
export function usageRatio(used: number, limit: number | undefined, total: number): number {
  const d = limit && limit > 0 ? limit : total;
  return d > 0 ? Math.min(1, Math.max(0, used / d)) : 0;
}

/** Subscribe a component to summary events for its lifetime (starts the app-wide subscription). */
export function useDownloads() {
  initDownloads();
  if (getOwner()) onCleanup(() => {});
}
