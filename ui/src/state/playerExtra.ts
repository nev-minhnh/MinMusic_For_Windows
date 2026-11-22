// Player state that does not belong to M1-3a's state/player.ts: support pane, lyrics fullscreen, full-player tab,
// sleep timer, output devices, speed, bar variants (local prefs until the Settings WP binds them).
import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js";
import { client } from "../lib/core";
import { playerState } from "./player";
import { size, wClass } from "../lib/layout";

// ---- tiny localStorage helpers: every access can throw (private window, blocked site data)
export const pref = {
  get(k: string, d: string): string {
    try { return localStorage.getItem(k) ?? d; } catch { return d; }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(k, v); } catch { /* ignore */ }
  },
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ---- support pane (frontend-spec 4)
export type PaneTab = "queue" | "lyrics";
export const PANE_MIN = 280, PANE_MAX = 480, PANE_DEF = 336, DOCK_MIN_CONTENT = 760;
const [paneOpen, setPaneOpen] = createSignal(false); // closed by default (owner decision 5)
const [paneTab, setPaneTab] = createSignal<PaneTab>("queue");
const [paneWidth, setPaneWidthSig] = createSignal(clamp(Number(pref.get("mm.paneW", String(PANE_DEF))) || PANE_DEF, PANE_MIN, PANE_MAX));
export { paneOpen, paneTab, paneWidth };
export const setPaneWidth = (w: number, persist = true) => {
  const v = Math.round(clamp(w, PANE_MIN, PANE_MAX));
  setPaneWidthSig(v);
  if (persist) pref.set("mm.paneW", String(v));
};
export const openPane = (tab: PaneTab) => { setPaneTab(tab); setPaneOpen(true); };
export const closePane = () => setPaneOpen(false);
export const setTab = (tab: PaneTab) => setPaneTab(tab);
export function togglePane(tab: PaneTab) {
  if (paneOpen() && paneTab() === tab) setPaneOpen(false);
  else openPane(tab);
}
/** Docks when the content column keeps at least 760 px, otherwise the pane overlays it (no scrim). */
export function dockedFor(winW: number, sb: number, paneW: number): boolean {
  return winW - sb - paneW >= DOCK_MIN_CONTENT;
}
export const paneDocked = createRoot(() =>
  createMemo(() => {
    const w = size().w; // settles at the end of a resize
    wClass();
    const win = document.querySelector<HTMLElement>(".win");
    const sb = win ? parseFloat(getComputedStyle(win).getPropertyValue("--sb")) || 0 : 0;
    return dockedFor(w, sb, paneWidth());
  })
);

// ---- full player: right-hand tab and the single-pane layer, lyrics fullscreen
export type FpTab = "lyrics" | "queue" | "related";
const [fpTab, setFpTab] = createSignal<FpTab>("lyrics");
const [fpLayer, setFpLayer] = createSignal(false); // one-pane layout: the "Lời / Tiếp theo" layer is up
export { fpTab, setFpTab, fpLayer, setFpLayer };
const [lyricsFs, setLyricsFs] = createSignal(false);
export { lyricsFs, setLyricsFs };
export const toggleLyricsFs = () => setLyricsFs((o) => !o);

// ---- popovers (one at a time). `anchor` is the button that opened it.
export type PopKind = "vol" | "sleep" | "output" | "more" | "lytools";
const [pop, setPop] = createSignal<{ kind: PopKind; anchor: HTMLElement; onSearch?: () => void } | null>(null);
export { pop };
export const closePop = () => setPop(null);
export function togglePop(kind: PopKind, anchor: HTMLElement, onSearch?: () => void) {
  setPop((p) => (p && p.kind === kind && p.anchor === anchor ? null : { kind, anchor, onSearch }));
}

// ---- bar variants (local prefs until M4 maps them to settings)
export type ProgressVariant = "line" | "wavy" | "thick";
const PV = ["line", "wavy", "thick"];
/** unset = the bar draws a line and the full player draws the wavy variant; a choice applies to both */
const [pv, setPV] = createSignal<ProgressVariant | null>(PV.includes(pref.get("mm.progressVariant", "")) ? (pref.get("mm.progressVariant", "") as ProgressVariant) : null);
export const barVariant = (): ProgressVariant => pv() ?? "line";
export const fpVariant = (): ProgressVariant => pv() ?? "wavy";
export const setProgressVariant = (v: ProgressVariant) => { setPV(v); pref.set("mm.progressVariant", v); };
/** Setting `desktopFloatingPlayerBar` */
const [floatingBar, setFloat] = createSignal(pref.get("mm.floatingBar", "0") === "1");
export { floatingBar };
export const setFloatingBar = (on: boolean) => { setFloat(on); pref.set("mm.floatingBar", on ? "1" : "0"); };

// ---- sleep timer. PlayerState.sleep is authoritative when the core sends it; the result of player.sleepTimer fills in otherwise.
type Sleep = { deadline?: number; endOfTrack: boolean };
const [localSleep, setLocalSleep] = createSignal<Sleep | null>(null);
export const sleep = (): Sleep | null => playerState()?.sleep ?? localSleep();
const [sleepLeft, setSleepLeft] = createSignal<number | null>(null);
/** ms until the sleep timer fires, null when none or "end of track" */
export { sleepLeft };
createRoot(() => {
  let t = 0;
  const tick = () => {
    const s = sleep();
    if (!s?.deadline) { setSleepLeft(null); return; }
    const left = s.deadline - Date.now();
    if (left <= 0) { setSleepLeft(null); setLocalSleep(null); return; }
    setSleepLeft(left);
    if (document.visibilityState !== "hidden") t = window.setTimeout(tick, (left % 1000) + 20);
  };
  createEffect(() => {
    sleep();
    clearTimeout(t);
    tick();
  });
  document.addEventListener("visibilitychange", () => { clearTimeout(t); tick(); });
});
export async function setSleepTimer(o: { minutes: number } | { endOfTrack: true } | { cancel: true }) {
  const r = await client.call<{ deadline?: number }>("player.sleepTimer", o);
  if ("cancel" in o) setLocalSleep(null);
  else if ("endOfTrack" in o) setLocalSleep({ endOfTrack: true });
  else setLocalSleep({ deadline: r?.deadline ?? Date.now() + o.minutes * 60_000, endOfTrack: false });
}

// ---- output devices
export type OutDevice = { id: string; name: string; kind: "speaker" | "wired" | "bluetooth" | "usb" | "other"; default: boolean };
const [outputs, setOutputs] = createSignal<{ devices: OutDevice[]; current: string }>({ devices: [], current: "" });
export { outputs };
export async function loadOutputs() {
  try { setOutputs(await client.call("player.output.list", {})); } catch { /* keep the last list */ }
}
export async function setOutput(id: string) {
  await client.call("player.output.set", { id });
  setOutputs((o) => ({ ...o, current: id }));
}

// ---- speed, seek, mute
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const setSpeed = (speed: number) => client.call("player.setSpeed", { speed });
export const seekTo = (ms: number) => client.call("player.seek", { ms: Math.max(0, Math.round(ms)) });

// keep a popover from outliving the thing under it
createRoot(() => createEffect(on(() => playerState()?.track?.id, () => { /* tools popover closes on track change */ if (pop()?.kind === "lytools") closePop(); }, { defer: true })));
