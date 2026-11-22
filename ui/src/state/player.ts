import { createSignal } from "solid-js";
import { client } from "../lib/core";
import type { PlayerState, PositionEvent } from "../lib/types";

/** pos(now) = posMs + (now - receivedAt) * rate, clamped to durMs (frontend-spec 6.4). */
export function interp(posMs: number, receivedAt: number, now: number, rate: number, durMs: number, playing = true): number {
  const p = playing ? posMs + (now - receivedAt) * rate : posMs;
  return Math.min(durMs > 0 ? durMs : p, Math.max(0, p));
}

const [state, setState] = createSignal<PlayerState | null>(null);
export { state as playerState };

let clock = { posMs: 0, at: 0, rate: 1, durMs: 0, playing: false };
/** Progress animation descriptor. Components apply it as CSS vars + animation, never per frame. */
export type Prog = { p0: number; remainMs: number; playing: boolean; n: number };
const [prog, setProg] = createSignal<Prog>({ p0: 0, remainMs: 0, playing: false, n: 0 });
export { prog };
const [elapsed, setElapsed] = createSignal(0);
export { elapsed };

export function positionNow(): number {
  return interp(clock.posMs, clock.at, performance.now(), clock.rate, clock.durMs, clock.playing);
}

let n = 0;
function resync() {
  const pos = positionNow();
  setProg({ p0: clock.durMs ? pos / clock.durMs : 0, remainMs: Math.max(0, clock.durMs - pos), playing: clock.playing, n: ++n });
  setElapsed(Math.floor(pos / 1000) * 1000);
  scheduleTick();
}

let tick = 0;
function scheduleTick() {
  clearTimeout(tick);
  if (!clock.playing || document.visibilityState === "hidden") return;
  const pos = positionNow();
  const wait = (1000 - (pos % 1000)) / clock.rate + 4; // aligned to the next whole second
  tick = window.setTimeout(() => {
    setElapsed(Math.floor(positionNow() / 1000) * 1000);
    scheduleTick();
  }, wait);
}

function onEvent(name: string, d: any) {
  if (name === "player.snapshot" || name === "player.state") {
    const s = d as PlayerState;
    setState(s);
    clock = { posMs: s.posMs, at: performance.now(), rate: s.speed || 1, durMs: s.durMs, playing: s.playing };
    resync();
  } else if (name === "player.position") {
    const e = d as PositionEvent;
    clock = { posMs: e.posMs, at: performance.now(), rate: e.rate || 1, durMs: e.durMs, playing: e.playing };
    resync();
  }
}

let started = false;
export function initPlayer() {
  if (started) return;
  started = true;
  client.sub("player", {}, onEvent);
  document.addEventListener("visibilitychange", () => (document.visibilityState === "visible" ? resync() : clearTimeout(tick)));
}

export const player = {
  play: (context: any, extra: Record<string, unknown> = {}) => client.call("player.play", { context, ...extra }),
  toggle: () => client.call("player.toggle"),
  next: () => client.call("player.next"),
  prev: () => client.call("player.prev"),
  seekPercent: (pct: number) => client.call("player.seekPercent", { pct }),
  setShuffle: (on: boolean) => client.call("player.setShuffle", { on }),
  cycleRepeat: () => client.call("player.cycleRepeat"),
  like: (id: string, liked: boolean) => client.call("track.like", { id, liked }),
};
