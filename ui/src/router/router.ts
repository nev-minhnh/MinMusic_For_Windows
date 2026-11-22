import { createMemo, createSignal } from "solid-js";

import type { RouteName } from "./routes";
export type { RouteName };
export type Route = { name: RouteName; params: Record<string, string>; key: string };
export type Dir = "init" | "push" | "pop" | "forward" | "replace";

export const KEEP_ALIVE = 5; // the current page and the 4 previous entries stay mounted

let seq = 0;
const mk = (name: RouteName, params: Record<string, string> = {}): Route => ({ name, params, key: `${name}#${++seq}` });

/** Pure stack operations, unit tested. */
export type Stack = { entries: Route[]; idx: number };
export const initial = (): Stack => ({ entries: [mk("home")], idx: 0 });
export const pushOp = (s: Stack, r: Route): Stack => ({ entries: [...s.entries.slice(0, s.idx + 1), r], idx: s.idx + 1 });
export const backOp = (s: Stack): Stack => (s.idx > 0 ? { ...s, idx: s.idx - 1 } : s);
export const forwardOp = (s: Stack): Stack => (s.idx < s.entries.length - 1 ? { ...s, idx: s.idx + 1 } : s);
export const replaceOp = (s: Stack, r: Route): Stack => ({ entries: s.entries.map((e, i) => (i === s.idx ? r : e)), idx: s.idx });
/** Entries kept alive: the current page and the 4 previous ones. Older entries unmount. */
export const mountedOf = (s: Stack): Route[] => s.entries.slice(Math.max(0, s.idx - (KEEP_ALIVE - 1)), s.idx + 1);

const [stack, setStack] = createSignal<Stack>(initial());
const [dir, setDir] = createSignal<Dir>("init");
const [leaving, setLeaving] = createSignal<Route[]>([]);

export const current = createMemo(() => stack().entries[stack().idx]);
export const mounted = createMemo(() => {
  const m = mountedOf(stack());
  const l = leaving().filter((r) => !m.some((x) => x.key === r.key));
  return [...m, ...l];
});
export const canBack = () => stack().idx > 0;
export const canForward = () => stack().idx < stack().entries.length - 1;
export const direction = dir;
export const stackSnapshot = stack;

let leaveTimer = 0;
function keepLeaving(r: Route | undefined, ms = 140) {
  if (!r) return;
  setLeaving([r]);
  clearTimeout(leaveTimer);
  leaveTimer = window.setTimeout(() => setLeaving([]), ms);
}

export function navigate(name: RouteName, params: Record<string, string> = {}) {
  const cur = current();
  if (cur.name === name && JSON.stringify(cur.params) === JSON.stringify(params)) return;
  setDir("push");
  setStack((s) => pushOp(s, mk(name, params)));
}
export function back() {
  if (!canBack()) return;
  keepLeaving(current());
  setDir("pop");
  setStack(backOp);
}
export function forward() {
  if (!canForward()) return;
  setDir("forward");
  setStack(forwardOp);
}
export function replace(name: RouteName, params: Record<string, string> = {}) {
  setDir("replace");
  setStack((s) => replaceOp(s, mk(name, params)));
}

/** Scroll positions of pages (saved passively, restored when an evicted entry mounts again). */
export const savedScroll = new Map<string, number>();
