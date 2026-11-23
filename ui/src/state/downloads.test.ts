import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEffect, createRoot } from "solid-js";
import type { DownloadQueueItem } from "@minmusic/protocol";
import { __applyQueue, __pushProgress, __resetDownloads, batchRatio, createProgressCoalescer, estimateBytes, failedCount, fmtBytes, qualityBars, queueIds, queueItem, usageRatio } from "./downloads";

describe("quality bar maths", () => {
  it("bars are the share of all downloads, largest first", () => {
    const bars = qualityBars([{ label: "320", count: 806 }, { label: "FLAC", count: 214 }, { label: "Opus 160", count: 228 }]);
    expect(bars.map((b) => b.label)).toEqual(["320", "Opus 160", "FLAC"]);
    expect(bars[0]!.share).toBeCloseTo(806 / 1248, 6);
    expect(bars.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 9);
    expect(bars.find((b) => b.label === "FLAC")!.lossless).toBe(true);
    expect(bars.find((b) => b.label === "320")!.lossless).toBe(false);
  });
  it("folds the tail beyond max into one bar and drops empty buckets", () => {
    const by = ["a", "b", "c", "d", "e", "f"].map((label, i) => ({ label, count: 10 - i }));
    const bars = qualityBars([...by, { label: "z", count: 0 }], 4, "other");
    expect(bars).toHaveLength(5);
    expect(bars[4]).toMatchObject({ label: "other", count: 6 + 5 });
    expect(bars.reduce((a, b) => a + b.count, 0)).toBe(by.reduce((a, b) => a + b.count, 0));
  });
  it("an empty library has no bars; the ratio helpers clamp", () => {
    expect(qualityBars([])).toEqual([]);
    expect(qualityBars([{ label: "x", count: 0 }])).toEqual([]);
    expect(batchRatio({ done: 3, total: 12 })).toBe(0.25);
    expect(batchRatio({ done: 5, total: 0 })).toBe(0);
    expect(batchRatio({ done: 20, total: 12 })).toBe(1);
    expect(usageRatio(512, 1024, 4096)).toBe(0.5);
    expect(usageRatio(512, undefined, 2048)).toBe(0.25);
    expect(usageRatio(5000, 1024, 0)).toBe(1);
    expect(usageRatio(0, undefined, 0)).toBe(0);
  });
  it("bytes and size estimates", () => {
    expect(fmtBytes(0, "en")).toBe("0 B");
    expect(fmtBytes(1536, "en")).toBe("2 KB");
    expect(fmtBytes(412 * 1024 * 1024, "en")).toBe("412 MB");
    expect(fmtBytes(6.2 * 1024 ** 3, "en")).toBe("6.2 GB");
    expect(fmtBytes(6.2 * 1024 ** 3, "vi")).toBe("6,2 GB");
    expect(estimateBytes({ kbps: 320 }, 180_000)).toBe(180 * 320 * 125);
    expect(estimateBytes({ lossless: true }, 100_000)).toBe(100 * 900 * 125);
    expect(estimateBytes(undefined, undefined)).toBe(200 * 160 * 125);
  });
});

describe("progress coalescing (<= 2 Hz rendering)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("applies at most one batch per 500 ms with the latest value per id", () => {
    const applied: { id: string; progress: number }[][] = [];
    const c = createProgressCoalescer((items) => applied.push(items), () => {}, 500);
    // 20 events per second for 3 seconds on two downloads
    for (let ms = 0; ms < 3000; ms += 50) {
      c.push({ id: "a", state: "downloading", progress: ms / 3000 });
      c.push({ id: "b", state: "downloading", progress: ms / 6000 });
      vi.advanceTimersByTime(50);
    }
    expect(applied.length).toBeLessThanOrEqual(7); // 3 s / 0.5 s = 6 (+ the first)
    expect(applied.length).toBeGreaterThanOrEqual(5);
    for (const batch of applied) expect(batch.map((x) => x.id).sort()).toEqual(["a", "b"]);
    const last = applied.at(-1)!.find((x) => x.id === "a")!;
    expect(last.progress).toBeGreaterThan(0.8); // the newest value won, not the first
  });
  it("state changes bypass the delay and drop the pending progress of that id", () => {
    const states: string[] = [];
    const prog: string[] = [];
    const c = createProgressCoalescer((i) => prog.push(...i.map((x) => x.id)), (e) => states.push(`${e.id}:${e.state}`), 500);
    c.push({ id: "a", state: "downloading", progress: 0.2 });
    c.push({ id: "a", state: "downloaded", progress: 1 });
    expect(states).toEqual(["a:downloaded"]);
    vi.advanceTimersByTime(600);
    expect(prog).toEqual([]);
    expect(c.size()).toBe(0);
  });
});

describe("queue store: a progress tick does not re-render the list", () => {
  const item = (id: string, state: DownloadQueueItem["state"] = "downloading", progress = 0): DownloadQueueItem =>
    ({ id, title: id, artists: [{ name: "x" }], source: "yt", state, progress }) as DownloadQueueItem;
  beforeEach(() => {
    vi.useFakeTimers();
    __resetDownloads();
  });
  afterEach(() => vi.useRealTimers());

  it("list effects run once; only the changed row's effect follows each flush", () => {
    __applyQueue([item("a"), item("b"), item("c", "queued"), item("d", "failed")]);
    let listRuns = 0;
    const rows: Record<string, number> = { a: 0, b: 0, c: 0 };
    let dispose = () => {};
    createRoot((d) => {
      dispose = d;
      createEffect(() => {
        queueIds().length;
        queueIds().forEach((_, i) => queueIds()[i]);
        listRuns++;
      });
      for (const id of ["a", "b", "c"]) createEffect(() => { queueItem(id)?.progress; rows[id]!++; });
    });
    expect([listRuns, rows.a, rows.b, rows.c]).toEqual([1, 1, 1, 1]);
    expect(failedCount()).toBe(1);
    // 3 s of 20 Hz events for "a" only
    for (let ms = 0; ms < 3000; ms += 50) {
      __pushProgress({ id: "a", state: "downloading", progress: ms / 3000 });
      vi.advanceTimersByTime(50);
    }
    expect(listRuns).toBe(1);
    expect(rows.a!).toBeGreaterThan(3);
    expect(rows.a!).toBeLessThanOrEqual(8); // <= 2 Hz
    expect(rows.b).toBe(1);
    expect(rows.c).toBe(1);
    dispose();
  });

  it("a finished download leaves the list without touching the other rows", () => {
    __applyQueue([item("a"), item("b")]);
    let bRuns = 0;
    createRoot(() => createEffect(() => { queueItem("b")?.progress; bRuns++; }));
    __pushProgress({ id: "a", state: "downloaded", progress: 1 });
    expect(queueIds()).toEqual(["b"]);
    expect(bRuns).toBe(1);
  });
});
