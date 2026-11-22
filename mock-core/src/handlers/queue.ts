// Queue area (api.md 3.6): queue.window/add/addContext/remove/move/select/clear/setAutoplay/radio + the `queue` topic.
// player.sleepTimer / output / mute / setSpeed live in player.ts (M1-5) and are not repeated here.
import type { HandlerModule } from "../state.ts";
import { resolveContext } from "../content.ts";
import { ApiErr, bad, notFound, reqBool, reqInt, reqStr, reqStrArr } from "../util.ts";

export const handlers: HandlerModule["handlers"] = {
  "queue.window": (p, { st }) => {
    const offset = reqInt(p, "offset", 0);
    const limit = reqInt(p, "limit", 1, 200);
    const pl = st.pl;
    return { total: pl.q.length, revision: pl.qRevision, currentIndex: pl.index, items: pl.q.slice(offset, offset + limit).map(st.qTrack) };
  },
  "queue.add": (p, { st }) => {
    const ids = reqStrArr(p, "ids");
    const pl = st.pl;
    const tracks = ids.map((id) => st.registry.get(id) ?? (() => { throw notFound(`unknown track ${id}`); })());
    let at = p.position === "next" ? pl.index + 1 : p.position === "end" ? pl.q.length : p.position;
    if (typeof at !== "number" || !Number.isInteger(at)) throw bad("position");
    at = Math.max(0, Math.min(pl.q.length, at));
    pl.q.splice(at, 0, ...st.toQ(tracks));
    if (at <= pl.index) pl.index += tracks.length;
    st.emitQueue(true);
    st.emitState(false);
    return { revision: pl.qRevision };
  },
  "queue.addContext": (p, { st }) => {
    if (!p?.context) throw bad("context required");
    const { tracks } = resolveContext(st, p.context);
    const pl = st.pl;
    let at = p.position === "next" ? pl.index + 1 : p.position === "end" ? pl.q.length : p.position;
    if (typeof at !== "number" || !Number.isInteger(at)) throw bad("position");
    at = Math.max(0, Math.min(pl.q.length, at));
    pl.q.splice(at, 0, ...st.toQ(tracks));
    if (at <= pl.index) pl.index += tracks.length;
    st.emitQueue(true);
    st.emitState(false);
    return { revision: pl.qRevision };
  },
  "queue.remove": (p, { st }) => {
    const qids = new Set(reqStrArr(p, "qids"));
    const pl = st.pl;
    const curQid = pl.q[pl.index]?.qid;
    const before = pl.q.length;
    let idxShift = 0;
    pl.q.forEach((x, i) => { if (qids.has(x.qid) && i < pl.index) idxShift++; });
    pl.q = pl.q.filter((x) => !qids.has(x.qid));
    if (pl.q.length === before) return {};
    if (curQid && qids.has(curQid)) {
      // the playing item was removed: carry on with whatever took its place (or stop at the end)
      pl.index = Math.min(pl.index - idxShift, pl.q.length - 1);
      if (pl.index >= 0) st.startAt(pl.index); else { pl.playing = false; }
      st.emitQueue(true);
      st.emitState();
    } else {
      pl.index -= idxShift;
      st.emitQueue(true);
      st.emitState(false);
    }
    return {};
  },
  "queue.move": (p, { st }) => {
    const from = reqInt(p, "from", 0);
    const to = reqInt(p, "to", 0);
    const rev = reqInt(p, "expectedRevision", 0);
    const pl = st.pl;
    if (rev !== pl.qRevision) throw new ApiErr("conflict", "queue revision changed", { retryable: true });
    if (from >= pl.q.length || to >= pl.q.length) throw bad("index out of range");
    if (from === to) return {};
    const cur = pl.q[pl.index];
    const [it] = pl.q.splice(from, 1);
    pl.q.splice(to, 0, it!);
    if (cur) pl.index = pl.q.indexOf(cur);
    st.emitQueue(true);
    st.emitState(false);
    return {};
  },
  "queue.select": (p, { st }) => {
    const qid = reqStr(p, "qid");
    const i = st.pl.q.findIndex((x) => x.qid === qid);
    if (i < 0) throw notFound("qid");
    st.startAt(i);
    st.emitState();
    return {};
  },
  "queue.clear": (p, { st }) => {
    if (p?.keepCurrent !== true) throw bad("keepCurrent:true required");
    const pl = st.pl;
    const cur = pl.q[pl.index];
    pl.q = cur ? [cur] : [];
    pl.index = cur ? 0 : -1;
    st.emitQueue(true);
    st.emitState(false);
    return {};
  },
  "queue.setAutoplay": (p, { st }) => { st.pl.autoplay = reqBool(p, "on"); st.emitState(false); return {}; },
  "queue.radio": (p, { st }) => {
    const seed = st.registry.get(reqStr(p, "seedId"));
    if (!seed) throw notFound("seedId");
    const more = st.relatedTracks(seed, 25);
    st.setQueue([seed, ...more], seed.title);
    st.emitQueue(true);
    st.startAt(0);
    st.emitState();
    return {};
  },
};

export const topics: HandlerModule["topics"] = {
  queue: ({ st }) => st.queueSnapshot(),
};
