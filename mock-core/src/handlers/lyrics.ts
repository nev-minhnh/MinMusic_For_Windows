// Lyrics area (api.md 3.7): lyrics.get/search/choose/setOffset/translate/romanize/edit/providers + the `lyrics` topic.
// Deterministic synthetic lyrics: ~one line every 5 s from 4 s, word timings proportional to word length. The provider
// (word-synced / line-synced / plain) is chosen with lyrics.choose; the default depends on the track id.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HandlerModule, MockState } from "../state.ts";
import { FIXTURES } from "../state.ts";
import { bad, hash32, reqBool, reqInt, reqStr } from "../util.ts";

const FX = JSON.parse(readFileSync(join(FIXTURES, "lyrics", "lines.json"), "utf8")) as { lines: string[]; tr: string; ro: string };
export const LINE_START_MS = 4000;
export const LINE_STEP_MS = 5000;

type Synced = "word" | "line" | "none";
type Cfg = { cand: string; offsetMs: number; tr: boolean; ro: boolean; lrc?: string };
const CANDS: { id: string; provider: string; synced: Synced }[] = [
  { id: "kugou-word", provider: "KuGou", synced: "word" },
  { id: "lrclib-line", provider: "LrcLib", synced: "line" },
  { id: "plain", provider: "Genius", synced: "none" },
];
const state = new WeakMap<MockState, Map<string, Cfg>>();
function cfgOf(st: MockState, trackId: string): Cfg {
  let m = state.get(st);
  if (!m) state.set(st, (m = new Map()));
  let c = m.get(trackId);
  if (!c) m.set(trackId, (c = { cand: hash32(trackId) % 2 === 0 ? "kugou-word" : "lrclib-line", offsetMs: 0, tr: false, ro: false }));
  return c;
}

function build(st: MockState, trackId: string) {
  const c = cfgOf(st, trackId);
  const cand = CANDS.find((x) => x.id === c.cand)!;
  const tr = st.registry.get(trackId);
  const dur = tr?.durationMs ?? 200_000;
  const seed = hash32(trackId);
  const n = Math.max(4, Math.min(40, Math.floor((dur - LINE_START_MS - 3000) / LINE_STEP_MS)));
  const lines: any[] = [];
  for (let i = 0; i < n; i++) {
    const text = FX.lines[(seed + i) % FX.lines.length]!;
    const t = LINE_START_MS + i * LINE_STEP_MS;
    const end = t + LINE_STEP_MS - 400;
    const line: any = { t, text };
    if (cand.synced !== "none") line.end = end;
    if (cand.synced === "word") {
      const ws = text.split(" ");
      const total = ws.reduce((a, w) => a + w.length + 1, 0);
      let at = t;
      line.words = ws.map((w, k) => {
        const len = Math.round(((end - t) * (w.length + 1)) / total);
        const x = { t: at, end: k === ws.length - 1 ? end : at + len, text: k === ws.length - 1 ? w : w + " " };
        at += len;
        return x;
      });
    }
    if (c.tr) line.tr = FX.tr;
    if (c.ro) line.ro = FX.ro;
    if (i % 7 === 3) line.agent = "v2";
    lines.push(line);
  }
  return { trackId, provider: cand.provider, synced: cand.synced, offsetMs: c.offsetMs, lines };
}

const push = (st: MockState, trackId: string) => {
  if (st.cur()?.id === trackId) st.emit("lyrics", "lyrics.updated", build(st, trackId));
};

export const handlers: HandlerModule["handlers"] = {
  "lyrics.get": (p, { st }) => build(st, reqStr(p, "trackId")),
  "lyrics.search": (p, { st }) => {
    const trackId = reqStr(p, "trackId");
    const q = typeof p.query === "string" ? p.query : "";
    const base = FX.lines.slice(0, 2).join(" / ");
    return {
      candidates: CANDS.filter((c) => !q || c.provider.toLowerCase().includes(q.toLowerCase()) || st.registry.get(trackId)?.title.toLowerCase().includes(q.toLowerCase()))
        .map((c) => ({ provider: c.provider, synced: c.synced, preview: base, id: c.id })),
    };
  },
  "lyrics.choose": (p, { st }) => {
    const trackId = reqStr(p, "trackId");
    const id = reqStr(p, "candidateId");
    if (!CANDS.some((c) => c.id === id)) throw bad("candidateId");
    cfgOf(st, trackId).cand = id;
    push(st, trackId);
    return {};
  },
  "lyrics.setOffset": (p, { st }) => {
    const trackId = reqStr(p, "trackId");
    cfgOf(st, trackId).offsetMs = reqInt(p, "ms", -30_000, 30_000);
    push(st, trackId);
    return {};
  },
  "lyrics.translate": (p, { st }) => {
    const trackId = reqStr(p, "trackId");
    cfgOf(st, trackId).tr = reqBool(p, "on");
    setTimeout(() => push(st, trackId), 60); // async provider
    return {};
  },
  "lyrics.romanize": (p, { st }) => {
    const trackId = reqStr(p, "trackId");
    cfgOf(st, trackId).ro = reqBool(p, "on");
    setTimeout(() => push(st, trackId), 60);
    return {};
  },
  "lyrics.edit": (p, { st }) => {
    const trackId = reqStr(p, "trackId");
    cfgOf(st, trackId).lrc = reqStr(p, "lrc");
    push(st, trackId);
    return {};
  },
};

export const topics: HandlerModule["topics"] = {
  lyrics: ({ st }) => { const t = st.cur(); return t ? build(st, t.id) : null; },
};
