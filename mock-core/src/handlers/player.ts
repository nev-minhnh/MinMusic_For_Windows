import type { HandlerModule } from "../state.ts";
import { resolveContext } from "../content.ts";
import { bad, isObj, notFound, reqBool, reqNum } from "../util.ts";

export const handlers: HandlerModule["handlers"] = {
  "player.play": (p, { st }) => {
    const pl = st.pl;
    if (!isObj(p) || !p.context) throw bad("context required");
    const { tracks, title } = resolveContext(st, p.context);
    if (tracks.length === 0) throw bad("empty context");
    let start = 0;
    if (typeof p.startId === "string") { start = tracks.findIndex((t) => t.id === p.startId); if (start < 0) throw notFound("startId"); }
    else if (typeof p.startIndex === "number") { start = p.startIndex; if (start < 0 || start >= tracks.length) throw bad("startIndex"); }
    if (typeof p.shuffle === "boolean") pl.shuffle = p.shuffle;
    if (pl.shuffle && p.startId === undefined && p.startIndex === undefined) start = Math.floor(st.rng() * tracks.length);
    st.setQueue(tracks, title);
    st.emitQueue(true);
    st.startAt(start);
    st.emitState();
    return {};
  },
  "player.toggle": (_p, { st }) => { st.pl.playing ? st.doPause() : st.doResume(); return {}; },
  "player.pause": (_p, { st }) => { st.doPause(); return {}; },
  "player.resume": (_p, { st }) => { st.doResume(); return {}; },
  "player.next": (_p, { st }) => { st.advance(1, false); return {}; },
  "player.prev": (_p, { st }) => {
    if (st.pl.index < 0) return {};
    if (st.posNow() > 3000) { st.setPos(0); st.emitPosition(); } else st.advance(-1, false);
    return {};
  },
  "player.seek": (p, { st }) => { const ms = reqNum(p, "ms", 0); if (st.cur()) { st.setPos(ms); st.emitPosition(); } return {}; },
  "player.seekRelative": (p, { st }) => { const d = reqNum(p, "deltaMs"); if (st.cur()) { st.setPos(st.posNow() + d); st.emitPosition(); } return {}; },
  "player.seekPercent": (p, { st }) => {
    const pct = reqNum(p, "pct", 0, 100);
    if (st.cur()) { st.setPos((st.durOf(st.cur()) * pct) / 100); st.emitPosition(); }
    return {};
  },
  "player.setVolume": (p, { st }) => { st.pl.volume = reqNum(p, "v", 0, 1); st.emitState(false); return {}; },
  "player.mute": (p, { st }) => { st.pl.muted = reqBool(p, "on"); st.emitState(false); return {}; },
  "player.setShuffle": (p, { st }) => { st.pl.shuffle = reqBool(p, "on"); st.emitState(false); return {}; },
  "player.setRepeat": (p, { st }) => {
    if (!["off", "all", "one"].includes(p?.mode)) throw bad("mode");
    st.pl.repeat = p.mode; st.emitState(false); return {};
  },
  "player.cycleRepeat": (_p, { st }) => {
    const pl = st.pl;
    pl.repeat = pl.repeat === "off" ? "all" : pl.repeat === "all" ? "one" : "off";
    st.emitState(false);
    return {};
  },
  "player.setSpeed": (p, { st }) => {
    const sp = reqNum(p, "speed", 0.25, 4);
    st.setPos(st.posNow()); st.pl.speed = sp;
    if (typeof p.pitch === "number") st.pl.pitch = p.pitch;
    st.emitState();
    return {};
  },
  "player.sleepTimer": (p) => (typeof p?.minutes === "number" ? { deadline: Date.now() + p.minutes * 60_000 } : {}),
  "player.output.list": (_p, { st }) => ({ devices: [{ id: "default", name: "Loa mặc định", kind: "speaker", default: true }], current: st.pl.output }),
  "player.output.set": (p) => { if (typeof p?.id !== "string" || !p.id) throw bad("id"); return {}; },
};

export const topics: HandlerModule["topics"] = {
  player: ({ st }) => st.playerSnapshot(),
};
