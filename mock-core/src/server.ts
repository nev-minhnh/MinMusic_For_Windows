// Mock core: speaks the api.md envelope over ws://127.0.0.1:<port>/rpc with hello/token/Origin checks,
// subscriptions and the M0 method set. Everything else answers `bad_request`.
// Runs directly on Node >= 22.6 (type stripping); no build step.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type {
  ApiError, ErrorCode, FilterSpec, HomeGetResult, LocalList, PlayContext, PlayerState, PlayerStateDelta, SortSpec, Track,
} from "@minmusic/protocol";
import { generateDataset, mulberry32, type Dataset, type MockAlbum } from "./gen.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures");
const MOCK_VERSION = "0.1.0-mock";
const POSITION_MIN_GAP_MS = 250; // 4 Hz ceiling
const POSITION_PERIOD_MS = 1000; // drift correction while playing

export interface MockOptions {
  /** 0 = ephemeral */
  port?: number;
  token: string;
  artToken?: string;
  /** extra allowed Origins, e.g. "http://localhost:5173" (the real core's --dev) */
  allowedOrigins?: string[];
  helloTimeoutMs?: number;
  seed?: number;
  songCount?: number;
  /** Keep remote artwork URLs verbatim (default: rewrite to locally served `core:mock/...` so offline dev renders) */
  remoteArt?: boolean;
  capabilities?: string[];
  host?: string;
}

export interface MockHandle {
  port: number;
  token: string;
  artToken: string;
  dataset: Dataset;
  /** Abruptly close every socket (simulates a core crash for the client). Server keeps listening. */
  dropConnections(code?: number): void;
  close(): Promise<void>;
  sessionCount(): number;
}

class ApiErr extends Error {
  readonly err: ApiError;
  constructor(code: ErrorCode, msg: string, extra: Partial<ApiError> = {}) {
    super(msg);
    this.err = { code, msg, retryable: false, ...extra };
  }
}
const bad = (msg: string) => new ApiErr("bad_request", msg);
const notFound = (msg: string) => new ApiErr("not_found", msg);

function isObj(v: unknown): v is Record<string, any> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function reqNum(p: any, k: string, min = -Infinity, max = Infinity): number {
  const v = p?.[k];
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw bad(`${k}: number in [${min}, ${max}] required`);
  return v;
}
function reqBool(p: any, k: string): boolean {
  if (typeof p?.[k] !== "boolean") throw bad(`${k}: boolean required`);
  return p[k];
}
function reqStr(p: any, k: string): string {
  if (typeof p?.[k] !== "string" || p[k] === "") throw bad(`${k}: non-empty string required`);
  return p[k];
}

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

type Session = {
  ws: WebSocket;
  authed: boolean;
  role: string;
  subs: Map<number, { topic: string; seq: number }>;
  nextSub: number;
  helloTimer: ReturnType<typeof setTimeout> | null;
};

const TOPICS = new Set(["player", "library", "app"]);

export async function startMock(opts: MockOptions): Promise<MockHandle> {
  const artToken = opts.artToken ?? "mockart";
  const dataset = generateDataset(opts.seed, opts.songCount);
  const home = JSON.parse(readFileSync(join(FIXTURES, "home.json"), "utf8")) as HomeGetResult;
  const albumFixture = JSON.parse(readFileSync(join(FIXTURES, "album.json"), "utf8"));
  const caps = opts.capabilities ?? [];

  // ---- track registry (library songs + everything that appears in fixtures)
  const registry = new Map<string, Track>(dataset.byId);
  const homeAlbums = new Map<string, any>();
  const registerItems = (items: any[]) => {
    for (const it of items) {
      if (it.t === "track") { const { t: _t, ...tr } = it; registry.set(tr.id, tr as Track); }
      else if (it.t === "album") homeAlbums.set(it.id, it);
    }
  };
  for (const sh of home.shelves) registerItems(sh.items);
  for (const t of albumFixture.tracks as Track[]) registry.set(t.id, t);
  const songIndex = new Map<string, number>();
  dataset.songs.forEach((s, i) => songIndex.set(s.id, i));

  // ---- library
  let libRevision = 1;
  const listCache = new Map<string, any[]>();
  const counts = () => ({
    songs: dataset.songs.length,
    liked: dataset.songs.filter((s) => s.liked).length,
    downloaded: dataset.songs.filter((s) => s.download === "downloaded").length,
    albums: dataset.albums.length,
    artists: dataset.artists.length,
    playlists: dataset.userAlbums.length,
    userAlbums: dataset.userAlbums.length,
  });

  function listItems(list: LocalList, sort: SortSpec, filter?: FilterSpec): any[] {
    const key = JSON.stringify([list, sort, filter, libRevision]);
    const hit = listCache.get(key);
    if (hit) return hit;
    let items: any[];
    if (list === "songs") items = dataset.songs.slice();
    else if (list === "liked") items = dataset.songs.filter((s) => s.liked);
    else if (list === "downloaded" || list === "cached") items = dataset.songs.filter((s) => s.download === "downloaded");
    else if (list === "albums") items = dataset.albums.map(({ trackIds: _t, label: _l, ...a }: MockAlbum) => a);
    else if (list === "artists") items = dataset.artists.slice();
    else if (list === "playlists") items = dataset.userAlbums.map(({ pinned: _p, revision: _r, ...c }) => c);
    else if (list === "history") items = [];
    else if (typeof list === "string" && list.startsWith("userAlbum:")) {
      const ua = dataset.userAlbums.find((u) => u.id === list.slice("userAlbum:".length));
      if (!ua) throw notFound(`unknown list ${list}`);
      const n = Number(ua.id.slice(3));
      items = dataset.songs.slice(n * 100, n * 100 + (ua.count ?? 20));
    } else throw bad(`unknown list ${String(list)}`);

    if (filter && (list === "songs" || list === "liked" || list === "downloaded" || list === "cached" || String(list).startsWith("userAlbum:"))) {
      const text = filter.text ? strip(filter.text) : "";
      items = items.filter((s: Track) => {
        if (filter.source && s.source !== filter.source) return false;
        if (filter.downloaded !== undefined && (s.download === "downloaded") !== filter.downloaded) return false;
        if (filter.liked !== undefined && !!s.liked !== filter.liked) return false;
        if (filter.explicit !== undefined && !!s.explicit !== filter.explicit) return false;
        if (text && !strip(`${s.title} ${s.artists.map((a) => a.name).join(" ")} ${s.album?.title ?? ""}`).includes(text)) return false;
        return true;
      });
    }
    if (list === "songs" || list === "liked" || list === "downloaded" || list === "cached") {
      const dir = sort.desc ? -1 : 1;
      const cmp = (a: Track, b: Track): number => {
        switch (sort.by) {
          case "added": return (a.addedAt ?? 0) - (b.addedAt ?? 0);
          case "title": return a.title.localeCompare(b.title, "vi");
          case "artist": return (a.artists[0]?.name ?? "").localeCompare(b.artists[0]?.name ?? "", "vi");
          case "album": return (a.album?.title ?? "").localeCompare(b.album?.title ?? "", "vi");
          case "duration": return (a.durationMs ?? 0) - (b.durationMs ?? 0);
          case "plays": return dataset.plays[songIndex.get(a.id)!]! - dataset.plays[songIndex.get(b.id)!]!;
          case "lastPlayed": return dataset.lastPlayed[songIndex.get(a.id)!]! - dataset.lastPlayed[songIndex.get(b.id)!]!;
          default: return 0;
        }
      };
      if (sort.by !== "custom") items.sort((a, b) => dir * cmp(a, b) || (songIndex.get(a.id)! - songIndex.get(b.id)!));
    }
    if (listCache.size > 32) listCache.clear();
    listCache.set(key, items);
    return items;
  }

  // ---- sessions and emit
  const sessions = new Set<Session>();
  function emit(topic: string, ev: string, p: unknown) {
    for (const s of sessions) {
      if (!s.authed) continue;
      for (const [subId, sub] of s.subs) {
        if (sub.topic !== topic) continue;
        sub.seq++;
        rawSend(s, JSON.stringify({ ev, p, sub: subId, seq: sub.seq }));
      }
    }
  }
  const localizeArt = (json: string): string =>
    opts.remoteArt ? json : json.replace(/"src":"https:\/\/[^"]+"/g, (m) => `"src":"core:mock/${hash32(m).toString(36)}"`);
  function rawSend(s: Session, json: string) {
    if (s.ws.readyState === WebSocket.OPEN) s.ws.send(localizeArt(json));
  }

  // ---- player simulation
  const rng = mulberry32(99);
  const pl = {
    queue: [] as Track[],
    index: -1,
    playing: false,
    anchorPos: 0,
    anchorAt: Date.now(),
    volume: 1,
    muted: false,
    shuffle: false,
    repeat: "off" as "off" | "all" | "one",
    speed: 1,
    pitch: 1,
    contextTitle: "",
    output: "default",
  };
  const cur = () => (pl.index >= 0 ? pl.queue[pl.index] : undefined);
  const durOf = (t?: Track) => (t ? t.durationMs ?? 200_000 : 0);
  const posNow = () => {
    const d = durOf(cur());
    let p = pl.anchorPos + (pl.playing ? (Date.now() - pl.anchorAt) * pl.speed : 0);
    if (p > d) p = d;
    return p < 0 ? 0 : p;
  };
  const setPos = (ms: number) => { pl.anchorPos = Math.max(0, Math.min(ms, durOf(cur()))); pl.anchorAt = Date.now(); };

  function playerDelta(): PlayerStateDelta {
    const t = cur() ?? null;
    const delta: PlayerStateDelta = {
      track: t, playing: pl.playing, buffering: false, reconnecting: false, durMs: durOf(t ?? undefined),
      volume: pl.volume, muted: pl.muted, shuffle: pl.shuffle, repeat: pl.repeat, speed: pl.speed, pitch: pl.pitch,
      eq: { enabled: false, profileName: "Flat" },
      canPrev: pl.index > 0 || pl.repeat === "all",
      canNext: pl.index >= 0 && (pl.index < pl.queue.length - 1 || pl.repeat === "all" || pl.shuffle),
      output: { id: "default", name: "Loa mặc định", kind: "speaker" },
    };
    if (pl.contextTitle) delta.context = { title: pl.contextTitle };
    if (t?.quality) delta.quality = t.quality;
    if (t) delta.source = t.source;
    return delta;
  }
  function playerSnapshot(): PlayerState {
    return { ...playerDelta(), posMs: posNow(), bufMs: Math.min(durOf(cur()), posNow() + 30_000), at: Date.now() };
  }
  let lastPosAt = 0;
  let posTimer: ReturnType<typeof setTimeout> | null = null;
  function emitPosition() {
    const now = Date.now();
    const gap = now - lastPosAt;
    if (gap < POSITION_MIN_GAP_MS) {
      if (!posTimer) posTimer = setTimeout(() => { posTimer = null; emitPosition(); }, POSITION_MIN_GAP_MS - gap + 1);
      return;
    }
    lastPosAt = now;
    const d = durOf(cur());
    const p = posNow();
    emit("player", "player.position", { posMs: p, durMs: d, bufMs: Math.min(d, p + 30_000), playing: pl.playing, rate: pl.speed, at: now });
  }
  const emitState = (withPos = true) => { emit("player", "player.state", playerDelta()); if (withPos) emitPosition(); };

  function startAt(i: number) {
    pl.index = i;
    pl.anchorPos = 0;
    pl.anchorAt = Date.now();
    pl.playing = true;
  }
  function advance(dir: 1 | -1, auto: boolean) {
    if (pl.queue.length === 0) return;
    if (auto && pl.repeat === "one") { setPos(0); pl.playing = true; return emitState(); }
    let n = pl.index + dir;
    if (dir === 1 && pl.shuffle && pl.queue.length > 1) {
      do { n = Math.floor(rng() * pl.queue.length); } while (n === pl.index);
    } else if (n >= pl.queue.length) {
      if (pl.repeat === "all") n = 0;
      else { if (auto) { pl.anchorPos = durOf(cur()); pl.anchorAt = Date.now(); pl.playing = false; emitState(); } return; }
    } else if (n < 0) {
      if (pl.repeat === "all") n = pl.queue.length - 1; else n = 0;
    }
    startAt(n);
    emitState();
  }
  const tick = setInterval(() => {
    if (!pl.playing) return;
    const d = durOf(cur());
    if (d > 0 && posNow() >= d) return advance(1, true);
    if (Date.now() - lastPosAt >= POSITION_PERIOD_MS) emitPosition();
  }, 100);

  function resolveContext(ctx: PlayContext): { tracks: Track[]; title: string } {
    if (!isObj(ctx) || typeof (ctx as any).kind !== "string") throw bad("context.kind required");
    switch (ctx.kind) {
      case "tracks": {
        if (!Array.isArray(ctx.ids)) throw bad("context.ids required");
        const tracks = ctx.ids.map((id) => registry.get(id) ?? (() => { throw notFound(`track ${id}`); })());
        return { tracks, title: ctx.title ?? "Hàng đợi" };
      }
      case "album": {
        const a = albumPage(ctx.id ?? "");
        return { tracks: a.tracks, title: a.album.title };
      }
      case "library": {
        const items = listItems(ctx.list ?? "songs", ctx.sort ?? { by: "added", desc: true }, ctx.filter);
        return { tracks: items.filter((x) => "source" in x && "artists" in x && !("kind" in x)) as Track[], title: "Thư viện" };
      }
      default:
        return { tracks: dataset.songs.slice(0, 50), title: "Radio" };
    }
  }

  // ---- album pages
  function albumPage(id: string) {
    if (id === albumFixture.album.id) return albumFixture;
    const a = dataset.albums.find((x) => x.id === id);
    if (a) {
      const tracks = a.trackIds.map((t) => dataset.byId.get(t)!);
      const { trackIds: _t, label, ...card } = a;
      return {
        album: { ...card, description: `Album giả của ${a.artists[0]!.name}.`, durationMs: tracks.reduce((s, t) => s + (t.durationMs ?? 0), 0), trackCount: tracks.length, year: a.year ?? 2020, label, saved: false },
        tracks, otherVersions: [], moreBy: undefined,
      };
    }
    const h = homeAlbums.get(id);
    if (h) {
      const { t: _t, ...card } = h;
      const start = hash32(id) % (dataset.songs.length - 12);
      const tracks = dataset.songs.slice(start, start + 10).map((t) => ({ ...t, art: card.art, album: { id, title: card.title } }));
      for (const t of tracks) registry.set(t.id, t);
      return {
        album: { ...card, description: "Nội dung giả cho mock core.", durationMs: tracks.reduce((s, t) => s + (t.durationMs ?? 0), 0), trackCount: tracks.length, year: card.year ?? 2021, label: "Mock Records", saved: false },
        tracks, otherVersions: [], moreBy: undefined,
      };
    }
    throw notFound(`album ${id}`);
  }

  // ---- handlers
  type Ctx = { s: Session };
  const H: Record<string, (p: any, c: Ctx) => unknown | Promise<unknown>> = {
    "sys.ping": () => ({ t: Date.now() }),
    "app.info": () => ({
      version: MOCK_VERSION, core: "mock-core", protocol: 1, buildTime: "2026-11-22T00:00:00Z",
      dataDirs: { data: "mock", config: "mock", state: "mock", cache: "mock", logs: "mock" }, portable: false,
    }),
    "app.log": (p) => { reqStr(p, "msg"); if (!["error", "warn", "info"].includes(p.level)) throw bad("level"); return {}; },

    "home.get": (p) => {
      const chip = typeof p?.chip === "string" ? p.chip : undefined;
      if (p?.refresh) setTimeout(() => emit("app", "home.updated", { shelves: home.shelves }), 600);
      return { ...home, chips: home.chips.map((c) => ({ ...c, selected: c.key === chip })), fromCache: true };
    },
    "library.counts": () => counts(),
    "library.window": (p) => {
      if (!isObj(p)) throw bad("params required");
      const offset = reqNum(p, "offset", 0);
      const limit = reqNum(p, "limit", 1, 200);
      if (!Number.isInteger(offset) || !Number.isInteger(limit)) throw bad("integers required");
      if (!p.sort || typeof p.sort.by !== "string") throw bad("sort required");
      if (typeof p.list !== "string") throw bad("list required");
      const items = listItems(p.list as LocalList, p.sort, p.filter);
      return { total: items.length, revision: libRevision, offset, items: items.slice(offset, offset + limit) };
    },
    "album.get": (p) => {
      const a = albumPage(reqStr(p, "id"));
      return a;
    },

    "player.play": (p) => {
      if (!isObj(p) || !p.context) throw bad("context required");
      const { tracks, title } = resolveContext(p.context);
      if (tracks.length === 0) throw bad("empty context");
      let start = 0;
      if (typeof p.startId === "string") { start = tracks.findIndex((t) => t.id === p.startId); if (start < 0) throw notFound("startId"); }
      else if (typeof p.startIndex === "number") { start = p.startIndex; if (start < 0 || start >= tracks.length) throw bad("startIndex"); }
      if (typeof p.shuffle === "boolean") pl.shuffle = p.shuffle;
      if (pl.shuffle && p.startId === undefined && p.startIndex === undefined) start = Math.floor(rng() * tracks.length);
      pl.queue = tracks; pl.contextTitle = title;
      startAt(start);
      emitState();
      return {};
    },
    "player.toggle": () => { pl.playing ? doPause() : doResume(); return {}; },
    "player.pause": () => { doPause(); return {}; },
    "player.resume": () => { doResume(); return {}; },
    "player.next": () => { advance(1, false); return {}; },
    "player.prev": () => {
      if (pl.index < 0) return {};
      if (posNow() > 3000) { setPos(0); emitPosition(); } else advance(-1, false);
      return {};
    },
    "player.seek": (p) => { const ms = reqNum(p, "ms", 0); if (cur()) { setPos(ms); emitPosition(); } return {}; },
    "player.seekRelative": (p) => { const d = reqNum(p, "deltaMs"); if (cur()) { setPos(posNow() + d); emitPosition(); } return {}; },
    "player.seekPercent": (p) => { const pct = reqNum(p, "pct", 0, 100); if (cur()) { setPos((durOf(cur()) * pct) / 100); emitPosition(); } return {}; },
    "player.setVolume": (p) => { pl.volume = reqNum(p, "v", 0, 1); emitState(false); return {}; },
    "player.mute": (p) => { pl.muted = reqBool(p, "on"); emitState(false); return {}; },
    "player.setShuffle": (p) => { pl.shuffle = reqBool(p, "on"); emitState(false); return {}; },
    "player.setRepeat": (p) => {
      if (!["off", "all", "one"].includes(p?.mode)) throw bad("mode");
      pl.repeat = p.mode; emitState(false); return {};
    },
    "player.cycleRepeat": () => { pl.repeat = pl.repeat === "off" ? "all" : pl.repeat === "all" ? "one" : "off"; emitState(false); return {}; },
    "player.setSpeed": (p) => {
      const sp = reqNum(p, "speed", 0.25, 4);
      setPos(posNow()); pl.speed = sp;
      if (typeof p.pitch === "number") pl.pitch = p.pitch;
      emitState(); return {};
    },
    "player.sleepTimer": (p) => (typeof p?.minutes === "number" ? { deadline: Date.now() + p.minutes * 60_000 } : {}),
    "player.output.list": () => ({ devices: [{ id: "default", name: "Loa mặc định", kind: "speaker", default: true }], current: pl.output }),
    "player.output.set": (p) => { reqStr(p, "id"); return {}; },

    "mock.libraryChanged": (p) => {
      libRevision++; listCache.clear();
      emit("library", "library.changed", { lists: Array.isArray(p?.lists) ? p.lists : ["songs"], revision: libRevision });
      return { revision: libRevision };
    },
  };
  function doPause() { if (!pl.playing) return; setPos(posNow()); pl.playing = false; emitState(); }
  function doResume() { if (pl.playing || pl.index < 0) return; if (posNow() >= durOf(cur())) setPos(0); pl.anchorAt = Date.now(); pl.playing = true; emitState(); }

  const topicSnapshot: Record<string, () => unknown> = {
    player: () => playerSnapshot(),
    library: () => ({ counts: counts(), revision: libRevision }),
    app: () => ({ toasts: [] }),
  };

  function handleSub(s: Session, m: string, p: any): unknown {
    if (m === "sub.open") {
      const topic = p?.topic;
      if (typeof topic !== "string" || !TOPICS.has(topic)) throw bad(`unsupported topic ${String(topic)}`);
      const id = s.nextSub++;
      const sub = { topic, seq: 0 };
      s.subs.set(id, sub);
      // The first event of a subscription is the snapshot, after the response.
      setImmediate(() => {
        if (!s.subs.has(id)) return;
        sub.seq++;
        rawSend(s, JSON.stringify({ ev: `${topic}.snapshot`, p: topicSnapshot[topic]!(), sub: id, seq: sub.seq }));
      });
      return { sub: id };
    }
    const id = p?.sub;
    if (typeof id !== "number") throw bad("sub required");
    s.subs.delete(id);
    return {};
  }

  // ---- transport
  const allowed = new Set(["", "http://tauri.localhost", ...(opts.allowedOrigins ?? [])]);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    const m = /^\/art\/([^/]+)\/(.+)$/.exec(u.pathname);
    if (req.method === "GET" && m) {
      if (u.searchParams.get("k") !== artToken) { res.writeHead(401).end(); return; }
      const w = Math.max(16, Math.min(1080, Number(u.searchParams.get("w")) || 256));
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=31536000, immutable" });
      res.end(artSvg(decodeURIComponent(m[2]!), w));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024, perMessageDeflate: false });
  server.on("upgrade", (req, socket, head) => {
    const path = (req.url ?? "").split("?")[0];
    const origin = req.headers.origin ?? "";
    if (path !== "/rpc" || !allowed.has(origin)) {
      socket.write(`HTTP/1.1 ${path !== "/rpc" ? "404 Not Found" : "403 Forbidden"}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });

  function onConnection(ws: WebSocket) {
    const s: Session = { ws, authed: false, role: "", subs: new Map(), nextSub: 1, helloTimer: null };
    sessions.add(s);
    s.helloTimer = setTimeout(() => { if (!s.authed) ws.close(4401, "hello timeout"); }, opts.helloTimeoutMs ?? 2000);
    ws.on("close", () => { sessions.delete(s); if (s.helloTimer) clearTimeout(s.helloTimer); });
    ws.on("error", () => {});
    ws.on("message", async (data, isBinary) => {
      if (isBinary) { ws.close(1003, "text frames only"); return; }
      let msg: any;
      try { msg = JSON.parse(data.toString("utf8")); } catch { ws.close(1007, "bad json"); return; }
      if (!s.authed) {
        if (msg?.m !== "sys.hello" || !isObj(msg.p) || msg.p.token !== opts.token) { ws.close(4401, "unauthorized"); return; }
        if (typeof msg.p.protocol !== "number" || msg.p.protocol < 0 || msg.p.protocol > 1) {
          rawSend(s, JSON.stringify({ id: msg.id, e: { code: "unsupported", msg: "protocol mismatch", retryable: false } }));
          ws.close(1002, "protocol");
          return;
        }
        s.authed = true; s.role = String(msg.p.role ?? "ui");
        if (s.helloTimer) { clearTimeout(s.helloTimer); s.helloTimer = null; }
        rawSend(s, JSON.stringify({
          id: msg.id,
          r: { protocol: 1, core: MOCK_VERSION, sessionId: `mock-${Date.now().toString(36)}`, capabilities: caps, serverTime: Date.now() },
        }));
        return;
      }
      if (typeof msg?.id !== "number" || typeof msg.m !== "string") { ws.close(1007, "bad envelope"); return; }
      try {
        let r: unknown;
        if (msg.m === "sys.hello") throw bad("already authenticated");
        else if (msg.m === "sub.open" || msg.m === "sub.close") r = handleSub(s, msg.m, msg.p);
        else {
          const h = H[msg.m];
          if (!h) throw bad(`unknown method ${msg.m}`);
          r = await h(msg.p, { s });
        }
        rawSend(s, JSON.stringify({ id: msg.id, r }));
      } catch (e) {
        const err = e instanceof ApiErr ? e.err : { code: "internal", msg: String((e as Error)?.message ?? e), retryable: false };
        rawSend(s, JSON.stringify({ id: msg.id, e: err }));
      }
    });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;

  return {
    port, token: opts.token, artToken, dataset,
    sessionCount: () => sessions.size,
    dropConnections(code = 1011) {
      for (const s of sessions) { try { s.ws.terminate(); } catch { /* ignore */ } }
      void code;
    },
    async close() {
      clearInterval(tick);
      if (posTimer) clearTimeout(posTimer);
      for (const s of sessions) { try { s.ws.terminate(); } catch { /* ignore */ } }
      wss.close();
      await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections?.(); });
    },
  };
}

function artSvg(id: string, size: number): string {
  const h = hash32(id);
  const h1 = h % 360, h2 = (h1 + 40 + ((h >>> 9) % 80)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1} 65% 45%)"/><stop offset="1" stop-color="hsl(${h2} 70% 30%)"/></linearGradient></defs>` +
    `<rect width="100" height="100" fill="url(#g)"/><text x="50" y="64" font-family="sans-serif" font-size="44" text-anchor="middle" fill="rgba(255,255,255,.75)">♪</text></svg>`;
}
