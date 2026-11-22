// Play contexts and the queue. The queue is the resolved list; `queue` topic = snapshot + queue.changed.
// Auto-advance and autoplay (5 related tracks when the queue ends) live in state.ts (advance()).
import type { PlayContext, Track } from "@minmusic/protocol";
import type { HandlerModule, MockState } from "../state.ts";
import { resolveContext } from "../content.ts";
import { ApiErr, bad, isObj, notFound, reqBool, reqInt, reqNum, reqStr, reqStrArr } from "../util.ts";

function insert(st: MockState, tracks: Track[], position: unknown): number {
  const pl = st.pl;
  const items = st.toQ(tracks);
  let at: number;
  if (position === "next") at = pl.index + 1;
  else if (position === "end") at = pl.q.length;
  else if (typeof position === "number" && Number.isInteger(position) && position >= 0) at = Math.min(position, pl.q.length);
  else throw bad("position: next|end|index");
  pl.q.splice(at, 0, ...items);
  if (pl.index >= 0 && at <= pl.index) pl.index += items.length;
  st.emitQueue(true);
  st.emitState(false); // canNext may change
  return pl.qRevision;
}
const idsToTracks = (st: MockState, ids: string[]) => ids.map((id) => st.registry.get(id) ?? (() => { throw notFound(`track ${id}`); })());

export const handlers: HandlerModule["handlers"] = {
  "player.play": (p, { st }) => {
    const pl = st.pl;
    if (!isObj(p) || !p.context) throw bad("context required");
    const { tracks, title } = resolveContext(st, p.context as PlayContext);
    if (tracks.length === 0) throw bad("empty context");
    let start = 0;
    if (typeof p.startId === "string") { start = tracks.findIndex((t) => t.id === p.startId); if (start < 0) throw notFound("startId"); }
    else if (typeof p.startIndex === "number") { start = p.startIndex; if (!Number.isInteger(start) || start < 0 || start >= tracks.length) throw bad("startIndex"); }
    if (typeof p.shuffle === "boolean") pl.shuffle = p.shuffle;
    if (pl.shuffle && p.startId === undefined && p.startIndex === undefined) start = Math.floor(st.rng() * tracks.length);
    st.setQueue(tracks, title);
    st.startAt(start);
    st.emitState();
    return {};
  },

  "queue.window": (p, { st }) => {
    const offset = reqInt(p, "offset", 0);
    const limit = reqInt(p, "limit", 1, 200);
    const pl = st.pl;
    return { total: pl.q.length, revision: pl.qRevision, currentIndex: pl.index, items: pl.q.slice(offset, offset + limit).map(st.qTrack) };
  },
  "queue.add": (p, { st }) => ({ revision: insert(st, idsToTracks(st, reqStrArr(p, "ids")), p?.position) }),
  "queue.addContext": (p, { st }) => {
    if (!isObj(p) || !p.context) throw bad("context required");
    return { revision: insert(st, resolveContext(st, p.context as PlayContext).tracks, p.position) };
  },
  "queue.setAutoplay": (p, { st }) => { st.pl.autoplay = reqBool(p, "on"); st.emitState(false); return {}; },

  // The methods below belong to M2-1 on the real core; the mock has them so the queue pane (M2-2) can be built first.
  "queue.remove": (p, { st }) => {
    const pl = st.pl;
    const gone = new Set(reqStrArr(p, "qids"));
    const curQid = pl.q[pl.index]?.qid;
    const removedBefore = pl.q.slice(0, Math.max(pl.index, 0)).filter((x) => gone.has(x.qid)).length;
    pl.q = pl.q.filter((x) => !gone.has(x.qid));
    if (curQid && gone.has(curQid)) {
      pl.index = Math.min(pl.index - removedBefore, pl.q.length - 1);
      if (pl.index >= 0) { st.startAt(pl.index); } else pl.playing = false;
    } else pl.index -= removedBefore;
    st.emitQueue(true);
    st.emitState();
    return {};
  },
  "queue.move": (p, { st }) => {
    const pl = st.pl;
    const from = reqInt(p, "from", 0), to = reqInt(p, "to", 0);
    if (reqNum(p, "expectedRevision") !== pl.qRevision) throw new ApiErr("conflict", "stale queue revision", { retryable: true, details: { revision: pl.qRevision } });
    if (from >= pl.q.length || to >= pl.q.length) throw bad("from/to out of range");
    const curQid = pl.q[pl.index]?.qid;
    const [x] = pl.q.splice(from, 1);
    pl.q.splice(to, 0, x!);
    if (curQid) pl.index = pl.q.findIndex((y) => y.qid === curQid);
    st.emitQueue(true);
    return {};
  },
  "queue.select": (p, { st }) => {
    const i = st.pl.q.findIndex((x) => x.qid === reqStr(p, "qid"));
    if (i < 0) throw notFound("qid");
    st.startAt(i);
    st.emitState();
    return {};
  },
  "queue.clear": (p, { st }) => {
    const pl = st.pl;
    reqBool(p, "keepCurrent");
    const keep = pl.q[pl.index];
    pl.q = keep ? [keep] : [];
    pl.index = keep ? 0 : -1;
    if (!keep) pl.playing = false;
    st.emitQueue(true);
    st.emitState(false);
    return {};
  },
  "queue.radio": (p, { st }) => {
    const seed = st.registry.get(reqStr(p, "seedId"));
    if (!seed) throw notFound(`track ${p.seedId}`);
    st.setQueue([seed, ...st.relatedTracks(seed, 24)], "Radio");
    st.startAt(0);
    st.emitState();
    return {};
  },
};

export const topics: HandlerModule["topics"] = {
  queue: ({ st }) => st.queueSnapshot(),
};
