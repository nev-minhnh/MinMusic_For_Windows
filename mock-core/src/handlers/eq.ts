// Equalizer area (api.md 3.8 + topic `eq`): a stateful EqState (32 bands max), undo/redo, profiles, APO import/export,
// AutoEq sample index, per-device binding, `eq.response` (real RBJ biquad magnitudes at 48 kHz) and `eq.spectrum`
// (30 Hz, only while a subscription has params {spectrum:true}).
// parseApo / formatApo / responseDb are exported for the UI vitest suite (the UI tests compare its own biquad.ts against this module).
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { EqBand, EqState } from "@minmusic/protocol";
import { FIXTURES, type HandlerModule, type MockState } from "../state.ts";
import { bad, isObj, notFound, reqBool, reqInt, reqNum, reqStr } from "../util.ts";

export const FS = 48000;
export const MAX_BANDS = 32;
const TYPES = ["PK", "LSC", "HSC", "LPQ", "HPQ", "BP", "NO"] as const;
type BType = (typeof TYPES)[number];
const CROSSFEEDS = ["off", "default", "chuMoy", "janMeier"] as const;

// ---- RBJ cookbook biquads, evaluated on the unit circle with complex arithmetic (independent of the UI's closed-form version)
export function rbjCoeffs(b: { type: string; freq: number; gain: number; q: number }, fs = FS): [number, number, number, number, number, number] {
  const w0 = (2 * Math.PI * b.freq) / fs, c = Math.cos(w0), s = Math.sin(w0);
  const A = Math.pow(10, b.gain / 40), alpha = s / (2 * b.q), sA = 2 * Math.sqrt(A) * alpha;
  switch (b.type) {
    case "LSC": return [A * (A + 1 - (A - 1) * c + sA), 2 * A * (A - 1 - (A + 1) * c), A * (A + 1 - (A - 1) * c - sA), A + 1 + (A - 1) * c + sA, -2 * (A - 1 + (A + 1) * c), A + 1 + (A - 1) * c - sA];
    case "HSC": return [A * (A + 1 + (A - 1) * c + sA), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - sA), A + 1 - (A - 1) * c + sA, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - sA];
    case "LPQ": return [(1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha];
    case "HPQ": return [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha];
    case "BP": return [alpha, 0, -alpha, 1 + alpha, -2 * c, 1 - alpha];
    case "NO": return [1, -2 * c, 1, 1 + alpha, -2 * c, 1 - alpha];
    default: return [1 + alpha * A, -2 * c, 1 - alpha * A, 1 + alpha / A, -2 * c, 1 - alpha / A]; // PK
  }
}
/** magnitude of one band at hz, in dB */
export function bandDb(b: { type: string; freq: number; gain: number; q: number }, hz: number, fs = FS): number {
  const [b0, b1, b2, a0, a1, a2] = rbjCoeffs(b, fs);
  const w = (2 * Math.PI * hz) / fs;
  const z1r = Math.cos(w), z1i = -Math.sin(w), z2r = Math.cos(2 * w), z2i = -Math.sin(2 * w);
  const nr = b0 + b1 * z1r + b2 * z2r, ni = b1 * z1i + b2 * z2i;
  const dr = a0 + a1 * z1r + a2 * z2r, di = a1 * z1i + a2 * z2i;
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}
export const logGrid = (n: number, lo = 20, hi = 20000) => Array.from({ length: n }, (_, i) => lo * Math.pow(hi / lo, i / (n - 1)));
export function responseDb(bands: { type: string; freq: number; gain: number; q: number }[], points: number) {
  const hz = logGrid(points);
  return { hz, db: hz.map((f) => bands.reduce((a, b) => a + bandDb(b, f), 0)) };
}

// ---- APO / AutoEQ ParametricEQ text
const num = (s: string | undefined, d: number) => (s === undefined ? d : Number(s));
export function parseApo(text: string): { preampDb: number; bands: EqBand[] } {
  let preampDb = 0;
  const bands: EqBand[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const pre = /^Preamp:\s*(-?\d+(?:\.\d+)?)\s*(?:dB)?/i.exec(line);
    if (pre) { preampDb = Number(pre[1]); continue; }
    const m = /^Filter\s*\d*:\s*(ON|OFF)\s+([A-Za-z]+)\s+Fc\s+(\d+(?:\.\d+)?)\s*(?:Hz)?(?:\s+Gain\s+(-?\d+(?:\.\d+)?)\s*(?:dB)?)?(?:\s+Q\s+(\d+(?:\.\d+)?))?(?:\s+BW\s+Oct\s+(\d+(?:\.\d+)?))?/i.exec(line);
    if (!m || m[1]!.toUpperCase() === "OFF") continue;
    const kind = m[2]!.toUpperCase();
    const type: BType | null = ({ PK: "PK", PEQ: "PK", LS: "LSC", LSC: "LSC", HS: "HSC", HSC: "HSC", LP: "LPQ", LPQ: "LPQ", HP: "HPQ", HPQ: "HPQ", BP: "BP", NO: "NO", NOTCH: "NO" } as Record<string, BType>)[kind] ?? null;
    if (!type) continue;
    let q = num(m[5], NaN);
    if (!Number.isFinite(q)) q = m[6] ? 1 / (2 * Math.sinh((Math.LN2 / 2) * Number(m[6]))) : type === "LSC" || type === "HSC" || type === "LPQ" || type === "HPQ" ? Math.SQRT1_2 : 1;
    const freq = Math.min(20000, Math.max(20, Number(m[3])));
    bands.push({ type, freq, gain: Math.min(24, Math.max(-24, num(m[4], 0))), q: Math.min(20, Math.max(0.1, q)) });
    if (bands.length >= MAX_BANDS) break;
  }
  if (!bands.length) throw bad("no filters in file");
  return { preampDb, bands };
}
const trim = (n: number, d: number) => String(Number(n.toFixed(d)));
export function formatApo(preampDb: number, bands: EqBand[]): string {
  const lines = [`Preamp: ${trim(preampDb, 2)} dB`];
  bands.forEach((b, i) => {
    const t = b.type;
    const gain = t === "PK" || t === "LSC" || t === "HSC" ? ` Gain ${trim(b.gain, 2)} dB` : "";
    lines.push(`Filter ${i + 1}: ON ${t} Fc ${trim(b.freq, 1)} Hz${gain} Q ${trim(b.q, 3)}`);
  });
  return lines.join("\n") + "\n";
}

// ---- model
interface Profile { id: string; name: string; builtin: boolean; bands: EqBand[]; preampDb: number; effects: EqState["effects"] }
interface Snap { bands: EqBand[]; preampDb: number; autoPreamp: boolean; effects: EqState["effects"]; profileId: string }
const DEFAULT_EFFECTS: EqState["effects"] = { bassDb: 0, trebleDb: 0, widthPct: 100, crossfeed: "off", limiter: true, outputDb: 0 };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function createModel(st: MockState) {
  const fixtures = JSON.parse(readFileSync(join(FIXTURES, "eq", "profiles.json"), "utf8")) as Omit<Profile, "effects">[];
  const autoeq = JSON.parse(readFileSync(join(FIXTURES, "eq", "autoeq-index.json"), "utf8")) as { name: string; source: string; variants: string[]; apo: string }[];
  const profiles: Profile[] = fixtures.map((p) => ({ ...clone(p), effects: { ...DEFAULT_EFFECTS } }));
  const first = profiles[0]!;
  const cur: Snap = { bands: clone(first.bands), preampDb: first.preampDb, autoPreamp: false, effects: { ...DEFAULT_EFFECTS }, profileId: first.id };
  const m = {
    st, profiles, autoeq, cur, enabled: true, undo: [] as Snap[], redo: [] as Snap[], lastBandPush: { at: 0, index: -1 },
    deviceProfiles: [] as { deviceId: string; deviceName: string; profileId: string }[],
    nextId: 1,
    spectrumTimer: null as ReturnType<typeof setInterval> | null,
  };
  return m;
}
type Model = ReturnType<typeof createModel>;
const models = new WeakMap<MockState, Model>();
const model = (st: MockState): Model => {
  let m = models.get(st);
  if (!m) { m = createModel(st); models.set(st, m); }
  return m;
};

const maxBoost = (m: Model) => Math.max(0, ...responseDb(m.cur.bands, 128).db);
function limiterReduction(m: Model) {
  if (!m.cur.effects.limiter) return 0;
  const peak = maxBoost(m) + (m.cur.autoPreamp ? 0 : m.cur.preampDb) + m.cur.effects.outputDb + Math.max(0, m.cur.effects.bassDb);
  return Number(Math.max(0, peak + 0.3).toFixed(1));
}
function state(m: Model): EqState {
  const preampDb = m.cur.autoPreamp ? -Number(maxBoost(m).toFixed(1)) : m.cur.preampDb;
  return {
    enabled: m.enabled, profileId: m.cur.profileId,
    profiles: m.profiles.map((p) => ({ id: p.id, name: p.name, builtin: p.builtin })),
    bands: clone(m.cur.bands), preampDb, autoPreamp: m.cur.autoPreamp, effects: { ...m.cur.effects },
    limiterReductionDb: limiterReduction(m), canUndo: m.undo.length > 0, canRedo: m.redo.length > 0,
    deviceProfiles: clone(m.deviceProfiles), maxBands: 32,
  };
}
const emit = (m: Model) => { m.st.emit("eq", "eq.state", state(m)); };
const snap = (m: Model): Snap => ({ bands: clone(m.cur.bands), preampDb: m.cur.preampDb, autoPreamp: m.cur.autoPreamp, effects: { ...m.cur.effects }, profileId: m.cur.profileId });
const restore = (m: Model, s: Snap) => { m.cur.bands = clone(s.bands); m.cur.preampDb = s.preampDb; m.cur.autoPreamp = s.autoPreamp; m.cur.effects = { ...s.effects }; m.cur.profileId = s.profileId; };
function pushUndo(m: Model, coalesceIndex = -1) {
  const now = Date.now();
  if (coalesceIndex >= 0 && m.lastBandPush.index === coalesceIndex && now - m.lastBandPush.at < 600) { m.lastBandPush.at = now; return; }
  m.undo.push(snap(m));
  if (m.undo.length > 100) m.undo.shift();
  m.redo = [];
  m.lastBandPush = { at: coalesceIndex >= 0 ? now : 0, index: coalesceIndex };
}
const sortBands = (b: EqBand[]) => b.sort((a, c) => a.freq - c.freq);
const find = (m: Model, id: string) => m.profiles.find((p) => p.id === id) ?? (() => { throw notFound(`profile ${id}`); })();
function load(m: Model, p: Profile) {
  m.cur.bands = clone(p.bands); m.cur.preampDb = p.preampDb; m.cur.effects = { ...p.effects }; m.cur.profileId = p.id;
}
function addProfile(m: Model, name: string, bands: EqBand[], preampDb: number): Profile {
  const p: Profile = { id: `u${m.nextId++}`, name, builtin: false, bands: clone(bands), preampDb, effects: { ...DEFAULT_EFFECTS } };
  m.profiles.push(p);
  return p;
}
const clampBand = (b: EqBand): EqBand => ({ type: b.type, freq: Math.min(20000, Math.max(20, b.freq)), gain: Math.min(24, Math.max(-24, b.gain)), q: Math.min(20, Math.max(0.1, b.q)) });

// ---- spectrum: 32 Uint8 at 30 Hz, only while some subscription asked for it
function ensureSpectrum(m: Model) {
  if (m.spectrumTimer) return;
  m.spectrumTimer = setInterval(() => {
    let any = false;
    const t = Date.now() / 1000;
    for (const s of m.st.sessions) {
      if (!s.authed) continue;
      for (const [id, sub] of s.subs) {
        if (sub.topic !== "eq" || sub.params?.spectrum !== true) continue;
        any = true;
        const bytes = new Uint8Array(32);
        const live = m.st.pl.playing;
        for (let i = 0; i < 32; i++) {
          const base = 150 - i * 3.2;
          const wob = live ? Math.sin(t * (2 + (i % 5)) + i) * 40 + Math.sin(t * 7.3 + i * 0.7) * 20 : 0;
          bytes[i] = Math.max(0, Math.min(255, Math.round(live ? base + wob : 10)));
        }
        sub.seq++;
        m.st.rawSend(s, JSON.stringify({ ev: "eq.spectrum", p: { b64: Buffer.from(bytes).toString("base64") }, sub: id, seq: sub.seq }));
      }
    }
    if (!any && m.spectrumTimer) { clearInterval(m.spectrumTimer); m.spectrumTimer = null; }
  }, 33);
  m.spectrumTimer.unref?.();
}

const reqIdx = (m: Model, p: any) => { const i = reqInt(p, "index", 0); if (i >= m.cur.bands.length) throw bad("index out of range"); return i; };

export const handlers: HandlerModule["handlers"] = {
  "eq.get": (_p, { st }) => state(model(st)),
  "eq.setEnabled": (p, { st }) => { const m = model(st); m.enabled = reqBool(p, "on"); emit(m); return {}; },
  "eq.setProfile": (p, { st }) => { const m = model(st); const pr = find(m, reqStr(p, "id")); pushUndo(m); load(m, pr); emit(m); return {}; },
  "eq.updateBand": (p, { st }) => {
    const m = model(st);
    const i = reqIdx(m, p);
    if (p.type !== undefined && !TYPES.includes(p.type)) throw bad("type");
    const patch: Partial<EqBand> = {};
    if (p.type !== undefined) patch.type = p.type;
    if (p.freq !== undefined) patch.freq = reqNum(p, "freq", 1, 100000);
    if (p.gain !== undefined) patch.gain = reqNum(p, "gain", -100, 100);
    if (p.q !== undefined) patch.q = reqNum(p, "q", 0.01, 100);
    pushUndo(m, i);
    m.cur.bands[i] = clampBand({ ...m.cur.bands[i]!, ...patch });
    emit(m);
    return {};
  },
  "eq.addBand": (p, { st }) => {
    const m = model(st);
    const freq = reqNum(p, "freq", 20, 20000);
    if (m.cur.bands.length >= MAX_BANDS) throw bad("band limit reached (32)");
    pushUndo(m);
    m.cur.bands.push({ type: "PK", freq, gain: 0, q: 1.41 });
    sortBands(m.cur.bands);
    emit(m);
    return {};
  },
  "eq.removeBand": (p, { st }) => { const m = model(st); const i = reqIdx(m, p); pushUndo(m); m.cur.bands.splice(i, 1); emit(m); return {}; },
  "eq.resetBand": (p, { st }) => { const m = model(st); const i = reqIdx(m, p); pushUndo(m); m.cur.bands[i] = { ...m.cur.bands[i]!, gain: 0 }; emit(m); return {}; },
  "eq.setPreamp": (p, { st }) => { const m = model(st); const db = reqNum(p, "db", -24, 24); pushUndo(m, 1001); m.cur.preampDb = db; m.cur.autoPreamp = false; emit(m); return {}; },
  "eq.setAutoPreamp": (p, { st }) => { const m = model(st); const on = reqBool(p, "on"); pushUndo(m); m.cur.autoPreamp = on; emit(m); return {}; },
  "eq.setEffects": (p, { st }) => {
    const m = model(st);
    if (!isObj(p)) throw bad("params");
    const e = { ...m.cur.effects };
    if (p.bassDb !== undefined) e.bassDb = reqNum(p, "bassDb", -12, 12);
    if (p.trebleDb !== undefined) e.trebleDb = reqNum(p, "trebleDb", -12, 12);
    if (p.widthPct !== undefined) e.widthPct = reqNum(p, "widthPct", 0, 200);
    if (p.crossfeed !== undefined) { if (!CROSSFEEDS.includes(p.crossfeed)) throw bad("crossfeed"); e.crossfeed = p.crossfeed; }
    if (p.limiter !== undefined) e.limiter = reqBool(p, "limiter");
    if (p.outputDb !== undefined) e.outputDb = reqNum(p, "outputDb", -24, 12);
    pushUndo(m, 1000); // drag of an effect slider = one undo step
    m.cur.effects = e;
    emit(m);
    return {};
  },
  "eq.profile.save": (p, { st }) => {
    const m = model(st);
    const name = reqStr(p, "name").trim();
    if (!name) throw bad("name");
    const asNew = reqBool(p, "asNew");
    const existing = m.profiles.find((x) => x.id === m.cur.profileId);
    let target: Profile;
    if (asNew || !existing || existing.builtin) target = addProfile(m, name, m.cur.bands, m.cur.preampDb);
    else { target = existing; target.name = name; target.bands = clone(m.cur.bands); target.preampDb = m.cur.preampDb; }
    target.effects = { ...m.cur.effects };
    m.cur.profileId = target.id;
    emit(m);
    return { id: target.id };
  },
  "eq.profile.rename": (p, { st }) => {
    const m = model(st);
    const pr = find(m, reqStr(p, "id"));
    if (pr.builtin) throw bad("built-in profiles cannot be renamed");
    pr.name = reqStr(p, "name").trim() || pr.name;
    emit(m);
    return {};
  },
  "eq.profile.delete": (p, { st }) => {
    const m = model(st);
    const pr = find(m, reqStr(p, "id"));
    if (pr.builtin) throw bad("built-in profiles cannot be deleted");
    m.profiles.splice(m.profiles.indexOf(pr), 1);
    m.deviceProfiles = m.deviceProfiles.filter((d) => d.profileId !== pr.id);
    if (m.cur.profileId === pr.id) { load(m, m.profiles[0]!); m.undo = []; m.redo = []; }
    emit(m);
    return {};
  },
  "eq.undo": (_p, { st }) => {
    const m = model(st);
    const s = m.undo.pop();
    if (s) { m.redo.push(snap(m)); restore(m, s); m.lastBandPush = { at: 0, index: -1 }; }
    emit(m);
    return {};
  },
  "eq.redo": (_p, { st }) => {
    const m = model(st);
    const s = m.redo.pop();
    if (s) { m.undo.push(snap(m)); restore(m, s); m.lastBandPush = { at: 0, index: -1 }; }
    emit(m);
    return {};
  },
  "eq.reset": (_p, { st }) => {
    const m = model(st);
    pushUndo(m);
    const pr = m.profiles.find((x) => x.id === m.cur.profileId) ?? m.profiles[0]!;
    load(m, pr);
    m.cur.autoPreamp = false;
    emit(m);
    return {};
  },
  "eq.importFile": (p, { st }) => {
    const m = model(st);
    const path = reqStr(p, "path");
    let text: string;
    try { text = readFileSync(path, "utf8"); } catch { throw notFound(`cannot read ${path}`); }
    const { preampDb, bands } = parseApo(text);
    pushUndo(m);
    const pr = addProfile(m, basename(path, extname(path)) || "Import", bands, preampDb);
    load(m, pr);
    emit(m);
    return { id: pr.id };
  },
  "eq.exportFile": (p, { st }) => {
    const m = model(st);
    const id = reqStr(p, "id");
    const path = reqStr(p, "path");
    const pr = id === m.cur.profileId ? { bands: m.cur.bands, preampDb: m.cur.preampDb } : find(m, id);
    try { writeFileSync(path, formatApo(pr.preampDb, pr.bands), "utf8"); } catch { throw bad(`cannot write ${path}`); }
    return {};
  },
  "eq.autoeq.search": (p, { st }) => {
    const m = model(st);
    const q = reqStr(p, "q").toLowerCase();
    return { items: m.autoeq.filter((x) => x.name.toLowerCase().includes(q)).map((x) => ({ name: x.name, source: x.source, variants: [...x.variants] })) };
  },
  "eq.autoeq.apply": (p, { st }) => {
    const m = model(st);
    const name = reqStr(p, "name");
    const e = m.autoeq.find((x) => x.name === name);
    if (!e) throw notFound(`autoeq ${name}`);
    if (p.variant !== undefined && !e.variants.includes(p.variant)) throw bad("variant");
    const { preampDb, bands } = parseApo(e.apo);
    pushUndo(m);
    const pr = addProfile(m, `${e.name} (AutoEq)`, bands, preampDb);
    load(m, pr);
    emit(m);
    return { id: pr.id };
  },
  "eq.device.bind": (p, { st }) => {
    const m = model(st);
    const deviceId = reqStr(p, "deviceId");
    m.deviceProfiles = m.deviceProfiles.filter((d) => d.deviceId !== deviceId);
    if (p.profileId !== null) {
      const pr = find(m, reqStr(p, "profileId"));
      m.deviceProfiles.push({ deviceId, deviceName: deviceId === "default" ? "Loa mặc định" : deviceId, profileId: pr.id });
    }
    emit(m);
    return {};
  },
  "eq.response": (p, { st }) => {
    const m = model(st);
    const n = reqInt(p, "points", 8, 2048);
    return responseDb(m.cur.bands, n);
  },
};

export const topics: HandlerModule["topics"] = {
  eq: ({ st }) => { const m = model(st); ensureSpectrum(m); return state(m); },
};
