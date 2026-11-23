// Mock of api.md 3.13 Listen Together (M3-4b). Single local user "me". Suggestions are event-only (no list method), so the UI keeps them.
// Test hooks (mock only): `mock.lt.joinRequest {name}` and `mock.lt.suggestion {trackId?, by?}`.
import type { LtState } from "@minmusic/protocol";
import type { HandlerModule, MockState } from "../state.ts";
import { bad, isObj, notFound, reqStr } from "../util.ts";

type Lt = {
  status: LtState["status"]; room?: NonNullable<LtState["room"]>; server: string; error?: string; me: string;
  blocked: { id: string; name?: string }[]; suggestions: Map<string, { trackId: string; by: string }>; seq: number;
};
const SERVERS = [
  { url: "wss://lt.mock.example/ws", name: "MinMusic (mặc định)" },
  { url: "wss://lt-backup.mock.example/ws", name: "Dự phòng" },
];
const stores = new WeakMap<MockState, Lt>();
function lt(st: MockState): Lt {
  let s = stores.get(st);
  if (!s) stores.set(st, (s = { status: "idle", server: SERVERS[0]!.url, me: "", blocked: [], suggestions: new Map(), seq: 0 }));
  return s;
}
const snapshot = (st: MockState): LtState => {
  const s = lt(st);
  return { status: s.status, ...(s.room ? { room: structuredClone(s.room) } : {}), server: s.server, ...(s.error ? { error: s.error } : {}) };
};
const push = (st: MockState, emit: MockState["emit"]) => emit("lt", "lt.state", snapshot(st));
const hosting = (st: MockState) => {
  const s = lt(st);
  if (s.status !== "host" || !s.room) throw bad("not hosting a room");
  return s as Lt & { room: NonNullable<Lt["room"]> };
};
const nameOf = (p: unknown) => reqStr(p, "name").trim().slice(0, 32);

export const handlers: HandlerModule["handlers"] = {
  "lt.state": (_p, { st }) => snapshot(st),
  "lt.create": (p, { st, emit }) => {
    const s = lt(st);
    if (s.status !== "idle") throw bad("already in a room");
    s.me = nameOf(p);
    s.room = { code: "K7QX2M", users: [{ id: "u-me", name: s.me, host: true }], pending: [] };
    s.status = "host";
    s.error = undefined;
    push(st, emit);
    return {};
  },
  "lt.join": (p, { st, emit }) => {
    const s = lt(st);
    if (s.status !== "idle") throw bad("already in a room");
    const code = reqStr(p, "code").trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) throw bad("code: 6 letters or digits");
    s.me = nameOf(p);
    if (code === "NOROOM") { s.error = "room_not_found"; push(st, emit); throw notFound("room"); }
    s.error = undefined;
    s.room = { code, users: [{ id: "u-host", name: "Lan", host: true }, { id: "u-me", name: s.me, host: false }], pending: [] };
    s.status = "guest";
    push(st, emit);
    return {};
  },
  "lt.leave": (_p, { st, emit }) => {
    const s = lt(st);
    s.status = "idle"; s.room = undefined; s.error = undefined; s.suggestions.clear();
    push(st, emit);
    return {};
  },
  "lt.approve": (p, { st, emit }) => {
    const s = hosting(st);
    const id = reqStr(p, "userId");
    const u = s.room.pending.find((x) => x.id === id);
    if (!u) throw notFound("pending user");
    s.room.pending = s.room.pending.filter((x) => x !== u);
    s.room.users.push({ id: u.id, name: u.name, host: false });
    push(st, emit);
    return {};
  },
  "lt.reject": (p, { st, emit }) => {
    const s = hosting(st);
    const id = reqStr(p, "userId");
    if (!s.room.pending.some((x) => x.id === id)) throw notFound("pending user");
    s.room.pending = s.room.pending.filter((x) => x.id !== id);
    push(st, emit);
    return {};
  },
  "lt.kick": (p, { st, emit }) => {
    const s = hosting(st);
    const id = reqStr(p, "userId");
    const u = s.room.users.find((x) => x.id === id);
    if (!u || u.host) throw notFound("guest");
    s.room.users = s.room.users.filter((x) => x !== u);
    if (!s.blocked.some((b) => b.id === id)) s.blocked.push({ id, name: u.name });
    push(st, emit);
    return {};
  },
  "lt.transferHost": (p, { st, emit }) => {
    const s = hosting(st);
    const id = reqStr(p, "userId");
    const u = s.room.users.find((x) => x.id === id);
    if (!u || u.host) throw notFound("guest");
    for (const x of s.room.users) x.host = x === u;
    s.status = "guest";
    push(st, emit);
    return {};
  },
  "lt.suggest": (p, { st, emit }) => {
    const s = lt(st);
    if (s.status !== "guest") throw bad("not a guest");
    const trackId = reqStr(p, "trackId");
    if (!st.registry.has(trackId)) throw notFound("track");
    const id = `sg-${++s.seq}`;
    s.suggestions.set(id, { trackId, by: s.me });
    emit("lt", "lt.suggestion", { id, trackId, by: s.me, track: st.registry.get(trackId) });
    return {};
  },
  "lt.suggestion.approve": (p, { st }) => {
    hosting(st);
    const id = reqStr(p, "id");
    if (!lt(st).suggestions.delete(id)) throw notFound("suggestion");
    return {};
  },
  "lt.suggestion.reject": (p, { st }) => {
    hosting(st);
    const id = reqStr(p, "id");
    if (!lt(st).suggestions.delete(id)) throw notFound("suggestion");
    return {};
  },
  "lt.servers": (_p, { st }) => ({ items: SERVERS, current: lt(st).server }),
  "lt.setServer": (p, { st, emit }) => {
    const url = reqStr(p, "url");
    if (!/^(wss?|https?):\/\/[^\s/]+/.test(url)) throw bad("url: ws(s):// or http(s)://");
    lt(st).server = url;
    push(st, emit);
    return {};
  },
  "lt.blocked": (_p, { st }) => ({ items: lt(st).blocked.map((b) => ({ ...b })) }),
  "lt.unblock": (p, { st }) => {
    const id = reqStr(p, "id");
    const s = lt(st);
    if (!s.blocked.some((b) => b.id === id)) throw notFound("blocked user");
    s.blocked = s.blocked.filter((b) => b.id !== id);
    return {};
  },
  "lt.invite": (_p, { st }) => ({ url: `metrolist://listen-together?code=${hosting(st).room.code}` }),

  "mock.lt.joinRequest": (p, { st, emit }) => {
    const s = hosting(st);
    const name = isObj(p) && typeof p.name === "string" ? p.name : "Hùng";
    const userId = `u-${++s.seq}`;
    s.room.pending.push({ id: userId, name });
    emit("lt", "lt.joinRequest", { userId, name });
    push(st, emit);
    return { userId };
  },
  "mock.lt.suggestion": (p, { st, emit }) => {
    const s = hosting(st);
    const trackId = isObj(p) && typeof p.trackId === "string" ? p.trackId : [...st.registry.keys()][0]!;
    const by = isObj(p) && typeof p.by === "string" ? p.by : "Hùng";
    const id = `sg-${++s.seq}`;
    s.suggestions.set(id, { trackId, by });
    emit("lt", "lt.suggestion", { id, trackId, by, track: st.registry.get(trackId) });
    return { id };
  },
};

export const topics: HandlerModule["topics"] = { lt: ({ st }) => snapshot(st) };
