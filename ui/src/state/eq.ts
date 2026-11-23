// Equalizer state: the `eq` topic, optimistic local edits, and the rAF coalescer for eq.updateBand (api.md 3.8: at most one
// per frame, the last one wins). Echoed eq.state events are held back while an edit is in flight so a drag never jumps back.
import { batch, createSignal } from "solid-js";
import type { EqBand, EqEffects, EqState } from "@minmusic/protocol";
import { client } from "../lib/core";

export type Patch = Record<string, unknown>;

/** Merges patches per key and sends at most one call per `schedule` tick; the last patch wins. Never two calls of one coalescer in flight. */
export function createCoalescer(
  send: (key: string, patch: Patch) => Promise<unknown>,
  opts: { schedule?: (cb: () => void) => unknown; onIdle?: () => void } = {},
) {
  const schedule = opts.schedule ?? ((cb) => requestAnimationFrame(() => cb()));
  const pend = new Map<string, Patch>();
  let queued = false;
  let inflight = 0;
  const busy = () => pend.size > 0 || inflight > 0;
  function flush() {
    queued = false;
    if (inflight > 0 || pend.size === 0) return; // reschedules itself when the call in flight returns
    const entries = [...pend];
    pend.clear();
    inflight = entries.length;
    for (const [k, p] of entries) {
      send(k, p).catch(() => {}).finally(() => {
        inflight--;
        if (inflight > 0) return;
        if (pend.size > 0) arm();
        else opts.onIdle?.();
      });
    }
  }
  function arm() {
    if (queued) return;
    queued = true;
    schedule(flush);
  }
  return {
    push(key: string, patch: Patch) {
      pend.set(key, { ...pend.get(key), ...patch });
      arm();
    },
    busy,
  };
}

// ---- signals
const [eqState, setEqState] = createSignal<EqState | null>(null);
export { eqState };
/** bumped on every local or remote change: the curve from eq.response is valid only for the revision it was fetched at */
const [rev, setRev] = createSignal(0);
export { rev as eqRev };
const [selected, setSelected] = createSignal(0);
export { selected as eqSelected };
const [dragging, setDragging] = createSignal(false);
export { dragging as eqDragging };
const [curve, setCurve] = createSignal<{ hz: number[]; db: number[]; rev: number } | null>(null);
export { curve as eqCurve };
const [status, setStatus] = createSignal<{ kind: "ok" | "err"; key: string; arg?: string } | null>(null);
export { status as eqStatus, setStatus as setEqStatus };

let deferred: EqState | null = null;

function apply(s: EqState) {
  batch(() => {
    setEqState(s);
    setRev((n) => n + 1);
    setSelected((i) => Math.min(Math.max(-1, i), s.bands.length - 1));
  });
  void refreshCurve();
}

const coalescer = createCoalescer(
  (key, patch) => {
    if (key === "fx") return client.call("eq.setEffects", patch);
    if (key === "pre") return client.call("eq.setPreamp", { db: patch.db });
    return client.call("eq.updateBand", { index: Number(key.slice(2)), ...patch });
  },
  { onIdle: () => settle() },
);
function settle() {
  if (!dragging() && !coalescer.busy() && deferred) {
    const d = deferred;
    deferred = null;
    apply(d);
  }
}
export const eqBusy = () => dragging() || coalescer.busy();

function onEvent(name: string, d: unknown) {
  if (name !== "eq.snapshot" && name !== "eq.state") return;
  if (eqBusy()) deferred = d as EqState;
  else apply(d as EqState);
}

let started = false;
/** Subscribes once (the page and the shell chip share it). */
export function initEq() {
  if (started) return;
  started = true;
  client.sub("eq", {}, onEvent);
  void client.call<EqState>("eq.get").then((s) => { if (!eqState()) apply(s); }).catch(() => {});
}

// ---- eq.response (the curve the core really applies); a stale answer is dropped
let curveSeq = 0;
let curveTimer = 0;
export function refreshCurve() {
  clearTimeout(curveTimer);
  curveTimer = window.setTimeout(async () => {
    if (dragging()) return;
    const mine = ++curveSeq;
    const at = rev();
    try {
      const r = await client.call<{ hz: number[]; db: number[] }>("eq.response", { points: 256 });
      if (mine === curveSeq && at === rev()) setCurve({ ...r, rev: at });
    } catch { /* keep the local curve */ }
  }, 0);
}

// ---- optimistic local edits
function localBands(f: (b: EqBand[]) => EqBand[]) {
  const s = eqState();
  if (!s) return;
  batch(() => { setEqState({ ...s, bands: f(s.bands.slice()) }); setRev((n) => n + 1); });
}
export const startDrag = () => setDragging(true);
export function endDrag() {
  setDragging(false);
  settle();
  refreshCurve();
}
export const selectBand = (i: number) => setSelected(i);

/** Moves a band now (local state) and tells the core at most once per frame. */
export function updateBand(index: number, patch: Partial<EqBand>) {
  localBands((b) => { if (b[index]) b[index] = { ...b[index]!, ...patch }; return b; });
  coalescer.push(`b:${index}`, patch);
}
export function setEffects(patch: Partial<EqEffects>) {
  const s = eqState();
  if (!s) return;
  batch(() => { setEqState({ ...s, effects: { ...s.effects, ...patch } }); setRev((n) => n + 1); });
  coalescer.push("fx", patch);
}
export function setPreamp(db: number) {
  const s = eqState();
  if (!s) return;
  batch(() => { setEqState({ ...s, preampDb: db, autoPreamp: false }); setRev((n) => n + 1); });
  coalescer.push("pre", { db });
}

// ---- plain calls (the eq.state event brings the result)
const run = (m: string, p?: unknown) =>
  client.call(m, p).catch((e: any) => { setStatus({ kind: "err", key: "w2_eq_err", arg: String(e?.msg ?? e?.message ?? e) }); throw e; });
export const eqApi = {
  setEnabled: (on: boolean) => run("eq.setEnabled", { on }),
  setProfile: (id: string) => run("eq.setProfile", { id }),
  addBand: (freq: number) => run("eq.addBand", { freq }),
  removeBand: (index: number) => run("eq.removeBand", { index }),
  resetBand: (index: number) => run("eq.resetBand", { index }),
  setAutoPreamp: (on: boolean) => run("eq.setAutoPreamp", { on }),
  undo: () => run("eq.undo"),
  redo: () => run("eq.redo"),
  reset: () => run("eq.reset"),
  saveProfile: (name: string, asNew: boolean) => run("eq.profile.save", { name, asNew }) as Promise<{ id: string }>,
  renameProfile: (id: string, name: string) => run("eq.profile.rename", { id, name }),
  deleteProfile: (id: string) => run("eq.profile.delete", { id }),
  importFile: (path: string) => run("eq.importFile", { path }) as Promise<{ id: string }>,
  exportFile: (id: string, path: string) => run("eq.exportFile", { id, path }),
  autoeqSearch: (q: string) => run("eq.autoeq.search", { q }) as Promise<{ items: { name: string; source: string; variants: string[] }[] }>,
  autoeqApply: (name: string, variant?: string) => run("eq.autoeq.apply", variant ? { name, variant } : { name }) as Promise<{ id: string }>,
  bindDevice: (deviceId: string, profileId: string | null) => run("eq.device.bind", { deviceId, profileId }),
};

// ---- keyboard steps (graph focus, frontend-spec 5): 1/12 octave and 0.5 dB (Shift 0.1)
const OCT12 = Math.pow(2, 1 / 12);
const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export function nudgeFreq(dir: 1 | -1, fine = false) {
  const s = eqState(), i = selected();
  const b = s?.bands[i];
  if (b) updateBand(i, { freq: clampN(Math.round(b.freq * Math.pow(OCT12, dir * (fine ? 0.2 : 1)) * 10) / 10, 20, 20000) });
}
export function nudgeGain(dir: 1 | -1, fine = false) {
  const s = eqState(), i = selected();
  const b = s?.bands[i];
  if (b) updateBand(i, { gain: clampN(Math.round((b.gain + dir * (fine ? 0.1 : 0.5)) * 10) / 10, -24, 24) });
}
export function stepSelection(dir: 1 | -1) {
  const n = eqState()?.bands.length ?? 0;
  if (n) setSelected((i) => clampN(i + dir, 0, n - 1));
}
