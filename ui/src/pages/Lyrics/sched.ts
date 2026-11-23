// Lyrics clock (frontend-spec 6.4): no rAF loop. A setTimeout is armed for the next line / word boundary, measured on
// the interpolated player clock, and re-armed on every position event.
import type { Lyrics } from "@minmusic/protocol";

export type LyricLine = Lyrics["lines"][number];

/**
 * Lyrics time = media position - offsetMs: a positive offset shows every line `offsetMs` later.
 * Index of the active line at `posMs`, or -1 before the first line. A line stays active until the next one starts.
 */
export function lineAt(lines: LyricLine[], posMs: number, offsetMs = 0): number {
  const e = posMs - offsetMs;
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.t <= e) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
/** Index of the word being sung (or the last one that started) in `line`, -1 before the first word. */
export function wordAt(line: LyricLine | undefined, posMs: number, offsetMs = 0): number {
  const ws = line?.words;
  if (!ws?.length) return -1;
  const e = posMs - offsetMs;
  let ans = -1;
  for (let i = 0; i < ws.length; i++) if (ws[i]!.t <= e) ans = i; else break;
  return ans;
}
/** Media position (ms) of the next line / word start strictly after `posMs`, or null at the end. */
export function nextBoundary(lines: LyricLine[], posMs: number, offsetMs = 0, wordSync = false): number | null {
  const e = posMs - offsetMs;
  const li = lineAt(lines, posMs, offsetMs);
  let best = Infinity;
  const next = lines[li + 1];
  if (next) best = next.t;
  if (wordSync && li >= 0) {
    for (const w of lines[li]!.words ?? []) if (w.t > e) { best = Math.min(best, w.t); break; }
  }
  return best === Infinity ? null : best + offsetMs;
}

export type SchedOpts = {
  /** interpolated media position, ms */
  pos: () => number;
  rate: () => number;
  playing: () => boolean;
  lyrics: () => Lyrics | null;
  /** word boundaries only matter in karaoke mode */
  wordSync: () => boolean;
  onLine: (index: number) => void;
  onWord: (line: number, word: number) => void;
};

/** setTimeout chain over line / word boundaries. `rearm()` after every position / state / lyrics / offset change. */
export function createLyricsScheduler(o: SchedOpts) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastLine = -2;
  let lastWord = -2;
  const sync = () => {
    const ly = o.lyrics();
    const lines = ly?.lines ?? [];
    const off = ly?.offsetMs ?? 0;
    const p = o.pos();
    const li = ly && ly.synced !== "none" ? lineAt(lines, p, off) : -1;
    const wi = o.wordSync() && li >= 0 ? wordAt(lines[li], p, off) : -1;
    if (li !== lastLine) { lastLine = li; lastWord = -2; o.onLine(li); }
    if (wi !== lastWord) { lastWord = wi; o.onWord(li, wi); }
    return { ly, lines, off, p };
  };
  const fire = () => { timer = undefined; arm(); };
  function arm() {
    clearTimeout(timer);
    timer = undefined;
    const { ly, lines, off, p } = sync();
    if (!ly || ly.synced === "none" || !o.playing()) return;
    const b = nextBoundary(lines, p, off, o.wordSync());
    if (b === null) return;
    const rate = o.rate() || 1;
    // +1 ms: a timer that fires a hair early would see the same index and re-arm for 0 ms
    timer = setTimeout(fire, Math.max(0, (b - p) / rate) + 1);
  }
  return {
    rearm: arm,
    stop() { clearTimeout(timer); timer = undefined; lastLine = -2; lastWord = -2; },
    /** forget what was emitted (a new lyrics object arrived) */
    reset() { lastLine = -2; lastWord = -2; arm(); },
  };
}

/** Manual scroll pauses auto-follow for `holdMs`; auto-follow scrolls at most once per line. */
export function createFollowGate(holdMs = 4000, now: () => number = () => Date.now()) {
  let until = 0;
  let lastIdx = -2;
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    /** user wheel / touch / drag / key on the scroller; `onResume` runs once the hold is over */
    user(onResume?: () => void) {
      until = now() + holdMs;
      clearTimeout(resumeTimer);
      if (onResume) resumeTimer = setTimeout(() => { until = 0; lastIdx = -2; onResume(); }, holdMs);
    },
    active: () => now() >= until,
    /** true when line `idx` should be scrolled to now (and remembers it) */
    shouldScroll(idx: number): boolean {
      if (idx < 0 || now() < until || idx === lastIdx) return false;
      lastIdx = idx;
      return true;
    },
    forget() { lastIdx = -2; },
    /** a click on a line: follow again right away */
    release() { until = 0; lastIdx = -2; clearTimeout(resumeTimer); },
    dispose() { clearTimeout(resumeTimer); },
  };
}
