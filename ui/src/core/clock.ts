// Interpolated playback clock (frontend-spec §6.4):
//   pos(now) = posMs + (performance.now() - receivedAt) * rate, clamped to [0, durMs]
// While paused the position is frozen. `at` (core epoch ms) is deliberately not used: local time only, so
// clock skew between processes cannot matter.

export interface ClockInput {
  posMs: number;
  durMs: number;
  playing: boolean;
  /** playback rate, default 1 */
  rate?: number;
}

export type NowFn = () => number;

export class PlaybackClock {
  private posMs = 0;
  private durMs = 0;
  private playing = false;
  private rate = 1;
  private receivedAt = 0;
  private nowFn: NowFn;

  constructor(nowFn: NowFn = () => performance.now()) {
    this.nowFn = nowFn;
    this.receivedAt = nowFn();
  }

  /** Feed a `player.position` / `player.state` update. `receivedAt` defaults to now. */
  update(s: ClockInput, receivedAt: number = this.nowFn()) {
    this.posMs = s.posMs;
    this.durMs = s.durMs;
    this.playing = s.playing;
    this.rate = s.rate ?? this.rate;
    this.receivedAt = receivedAt;
  }

  /** Update only the fields given (e.g. `player.state` carries no position). Rebases first. */
  patch(s: Partial<ClockInput>) {
    const now = this.nowFn();
    const cur = this.position(now);
    this.posMs = s.posMs ?? cur;
    this.receivedAt = now;
    if (s.durMs !== undefined) this.durMs = s.durMs;
    if (s.playing !== undefined) this.playing = s.playing;
    if (s.rate !== undefined) this.rate = s.rate;
  }

  get isPlaying(): boolean { return this.playing; }
  get duration(): number { return this.durMs; }
  get speed(): number { return this.rate; }

  /** Interpolated position in ms. */
  position(now: number = this.nowFn()): number {
    let p = this.posMs;
    if (this.playing) p += (now - this.receivedAt) * this.rate;
    if (this.durMs > 0 && p > this.durMs) p = this.durMs;
    return p < 0 ? 0 : p;
  }

  /** 0..1, for the progress CSS variables. */
  fraction(now: number = this.nowFn()): number {
    return this.durMs > 0 ? this.position(now) / this.durMs : 0;
  }

  /** Remaining ms of the track at the current rate (for the CSS animation duration). */
  remainingMs(now: number = this.nowFn()): number {
    const r = this.rate > 0 ? this.rate : 1;
    return Math.max(0, (this.durMs - this.position(now)) / r);
  }

  /** Wall-clock ms until the displayed whole second changes (for the label timer). `null` when paused. */
  msToNextSecond(now: number = this.nowFn()): number | null {
    if (!this.playing || this.rate <= 0) return null;
    const p = this.position(now);
    if (this.durMs > 0 && p >= this.durMs) return null;
    const into = p % 1000;
    return Math.max(1, Math.ceil((1000 - into) / this.rate));
  }

  /** Wall-clock ms until the position reaches `targetMs` (lyrics line scheduling). `null` if never/paused. */
  msUntil(targetMs: number, now: number = this.nowFn()): number | null {
    if (!this.playing || this.rate <= 0) return null;
    const d = targetMs - this.position(now);
    if (d <= 0) return 0;
    if (this.durMs > 0 && targetMs > this.durMs) return null;
    return Math.ceil(d / this.rate);
  }
}

/** m:ss or h:mm:ss */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s < 10 ? `0${s}` : `${s}`;
  if (h > 0) return `${h}:${m < 10 ? "0" : ""}${m}:${ss}`;
  return `${m}:${ss}`;
}
