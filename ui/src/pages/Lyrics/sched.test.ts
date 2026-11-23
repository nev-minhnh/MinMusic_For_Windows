import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFollowGate, createLyricsScheduler, lineAt, nextBoundary, wordAt, type LyricLine } from "./sched";
import type { Lyrics } from "@minmusic/protocol";

const lines: LyricLine[] = [
  { t: 1000, end: 3000, text: "a b", words: [{ t: 1000, end: 1800, text: "a " }, { t: 1800, end: 3000, text: "b" }] },
  { t: 4000, end: 6000, text: "c d", words: [{ t: 4000, end: 5000, text: "c " }, { t: 5000, end: 6000, text: "d" }] },
  { t: 7000, end: 9000, text: "e", words: [{ t: 7000, end: 9000, text: "e" }] },
];

describe("lineAt / wordAt / nextBoundary", () => {
  it("finds the active line, -1 before the first", () => {
    expect(lineAt(lines, 0)).toBe(-1);
    expect(lineAt(lines, 999)).toBe(-1);
    expect(lineAt(lines, 1000)).toBe(0);
    expect(lineAt(lines, 3500)).toBe(0); // between lines the previous one stays active
    expect(lineAt(lines, 4000)).toBe(1);
    expect(lineAt(lines, 99999)).toBe(2);
  });
  it("applies the offset: positive = later", () => {
    expect(lineAt(lines, 1200, 500)).toBe(-1);
    expect(lineAt(lines, 1500, 500)).toBe(0);
    expect(lineAt(lines, 3500, -600)).toBe(1);
  });
  it("word index", () => {
    expect(wordAt(lines[0], 900)).toBe(-1);
    expect(wordAt(lines[0], 1000)).toBe(0);
    expect(wordAt(lines[0], 1800)).toBe(1);
    expect(wordAt({ t: 0, text: "x" }, 10)).toBe(-1);
  });
  it("next boundary is a line start, or a word start in karaoke mode", () => {
    expect(nextBoundary(lines, 0)).toBe(1000);
    expect(nextBoundary(lines, 1000)).toBe(4000);
    expect(nextBoundary(lines, 1000, 0, true)).toBe(1800);
    expect(nextBoundary(lines, 5200, 0, true)).toBe(7000);
    expect(nextBoundary(lines, 7000, 0, true)).toBeNull();
    expect(nextBoundary(lines, 1000, 250, true)).toBe(1250);
    expect(nextBoundary(lines, 1300, 250, true)).toBe(2050);
  });
});

describe("scheduler on a fake clock", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  const ly = (synced: "word" | "line", offsetMs = 0): Lyrics => ({ trackId: "t", provider: "p", synced, offsetMs, lines });

  function run(opts: { synced?: "word" | "line"; offsetMs?: number; rate?: number; wordSync?: boolean; startPos?: number }) {
    const rate = opts.rate ?? 1;
    const t0 = Date.now();
    const base = opts.startPos ?? 0;
    let playing = true;
    const pos = () => (playing ? base + (Date.now() - t0) * rate : base);
    const events: { at: number; kind: string; a: number; b?: number }[] = [];
    const s = createLyricsScheduler({
      pos, rate: () => rate, playing: () => playing, lyrics: () => ly(opts.synced ?? "word", opts.offsetMs),
      wordSync: () => opts.wordSync ?? true,
      onLine: (i) => events.push({ at: pos(), kind: "line", a: i }),
      onWord: (l, w) => events.push({ at: pos(), kind: "word", a: l, b: w }),
    });
    return { s, events, pause: () => { playing = false; s.rearm(); } };
  }

  it("fires each line and word boundary within 50 ms of the clock", () => {
    const { s, events } = run({});
    s.rearm();
    vi.advanceTimersByTime(10_000);
    const lineEv = events.filter((e) => e.kind === "line" && e.a >= 0);
    expect(lineEv.map((e) => e.a)).toEqual([0, 1, 2]);
    expect(lineEv.map((e) => Math.abs(e.at - lines[e.a]!.t)).every((d) => d <= 50)).toBe(true);
    const wordEv = events.filter((e) => e.kind === "word" && e.b! >= 0);
    expect(wordEv.map((e) => `${e.a}.${e.b}`)).toEqual(["0.0", "0.1", "1.0", "1.1", "2.0"]);
    for (const e of wordEv) expect(Math.abs(e.at - lines[e.a]!.words![e.b!]!.t)).toBeLessThanOrEqual(50);
  });
  it("line-synced lyrics: no word events when karaoke is off", () => {
    const { s, events } = run({ synced: "line", wordSync: false });
    s.rearm();
    vi.advanceTimersByTime(10_000);
    expect(events.filter((e) => e.kind === "word" && e.b! >= 0)).toHaveLength(0);
    expect(events.filter((e) => e.kind === "line" && e.a >= 0)).toHaveLength(3);
  });
  it("honours the playback rate and the offset", () => {
    const { s, events } = run({ rate: 2, offsetMs: 500, wordSync: false });
    s.rearm();
    vi.advanceTimersByTime(6000);
    const l = events.filter((e) => e.kind === "line" && e.a >= 0);
    expect(l.map((e) => e.a)).toEqual([0, 1, 2]);
    for (const e of l) expect(Math.abs(e.at - (lines[e.a]!.t + 500))).toBeLessThanOrEqual(50);
  });
  it("re-arm after a seek jumps to the right line immediately", () => {
    const { s, events } = run({ startPos: 5200 });
    s.rearm();
    expect(events.find((e) => e.kind === "line")?.a).toBe(1);
    expect(events.find((e) => e.kind === "word" && e.b! >= 0)).toMatchObject({ a: 1, b: 1 });
  });
  it("sets no timers while paused or past the last boundary", () => {
    const { s, pause } = run({});
    s.rearm();
    pause();
    expect(vi.getTimerCount()).toBe(0);
    const r = run({ startPos: 99_999 });
    r.s.rearm();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("follow gate", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());
  it("scrolls at most once per line", () => {
    const g = createFollowGate(4000);
    expect(g.shouldScroll(3)).toBe(true);
    expect(g.shouldScroll(3)).toBe(false);
    expect(g.shouldScroll(4)).toBe(true);
    expect(g.shouldScroll(-1)).toBe(false);
  });
  it("a manual scroll pauses follow for 4 s, then resumes with a callback", () => {
    const g = createFollowGate(4000);
    const resume = vi.fn();
    g.shouldScroll(1);
    g.user(resume);
    expect(g.shouldScroll(2)).toBe(false);
    vi.advanceTimersByTime(3999);
    expect(g.shouldScroll(2)).toBe(false);
    expect(resume).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(g.shouldScroll(2)).toBe(true);
  });
  it("another input extends the pause", () => {
    const g = createFollowGate(4000);
    const resume = vi.fn();
    g.user(resume);
    vi.advanceTimersByTime(3000);
    g.user(resume);
    vi.advanceTimersByTime(3000);
    expect(resume).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1100);
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
