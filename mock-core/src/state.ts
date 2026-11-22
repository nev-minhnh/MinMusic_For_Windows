// Shared mock state: dataset, registry, library revision, user albums, history, player + queue simulation.
// Handlers receive it as `ctx.st` (see server.ts). One MockState per startMock() call.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import type {
  AlbumCard, FilterSpec, HomeGetResult, LocalList, PlayerState, PlayerStateDelta, PlaylistCard, SortSpec, Track,
} from "@minmusic/protocol";
import { generateDataset, mulberry32, NOW, type Dataset, type HistoryEvent, type MockAlbum } from "./gen.ts";
import { bad, hash32, notFound, strip } from "./util.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, "..", "fixtures");
export const POSITION_MIN_GAP_MS = 250; // 4 Hz ceiling
export const POSITION_PERIOD_MS = 1000; // drift correction while playing
export const LIBRARY_EMIT_GAP_MS = 250; // library.changed <= 4 Hz

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

export type Session = {
  ws: WebSocket;
  authed: boolean;
  role: string;
  subs: Map<number, { topic: string; seq: number; params?: Record<string, unknown> }>;
  nextSub: number;
  helloTimer: ReturnType<typeof setTimeout> | null;
  /** search.suggest in flight: calling it cancels the previous call of the same connection */
  cancelSuggest?: () => void;
};

export interface QItem { qid: string; track: Track }
export interface UserAlbum { id: string; title: string; pinned: boolean; cover?: string; entries: { entryId: string; trackId: string }[] }

export type MockState = ReturnType<typeof createState>;
export type Ctx = { s: Session; st: MockState; emit: MockState["emit"] };
export type Handler = (p: any, ctx: Ctx) => unknown | Promise<unknown>;
export type TopicSnapshot = (ctx: { st: MockState }) => unknown;
export interface HandlerModule { handlers?: Record<string, Handler>; topics?: Record<string, TopicSnapshot> }

export function createState(opts: MockOptions) {
  const artToken = opts.artToken ?? "mockart";
  const dataset: Dataset = generateDataset(opts.seed, opts.songCount);
  const home = JSON.parse(readFileSync(join(FIXTURES, "browse", "home.json"), "utf8")) as HomeGetResult;
  const albumFixture = JSON.parse(readFileSync(join(FIXTURES, "pages", "album.json"), "utf8"));
  const caps = opts.capabilities ?? [];

  // ---- registry: library songs + everything that appears in fixtures
  const registry = new Map<string, Track>(dataset.byId);
  const homeAlbums = new Map<string, any>();
  const homeArtists = new Map<string, any>();
  const playlists = new Map<string, PlaylistCard>();
  for (const sh of home.shelves) {
    for (const it of sh.items as any[]) {
      if (it.t === "track") { const { t: _t, ...tr } = it; registry.set(tr.id, tr as Track); }
      else if (it.t === "album") homeAlbums.set(it.id, it);
      else if (it.t === "artist") homeArtists.set(it.id, it);
      else if (it.t === "playlist") { const { t: _t, ...pc } = it; playlists.set(pc.id, pc as PlaylistCard); }
    }
  }
  for (const t of albumFixture.tracks as Track[]) registry.set(t.id, t);
  const songIndex = new Map<string, number>();
  dataset.songs.forEach((s, i) => songIndex.set(s.id, i));
  // 12 more remote playlists so search / library / pages have something to show
  {
    const pr = mulberry32(4242);
    const titles = ["Nhạc Trẻ Mới Nhất", "Chill Cùng Mưa", "Bolero Chọn Lọc", "Indie Việt", "EDM Việt Mix", "Nhạc Không Lời Học Bài",
      "Pop Quốc Tế", "R&B Việt", "Nhạc Phim Hay", "Workout Beats", "Nhạc Cho Ngày Mưa", "Hit Một Thời"];
    titles.forEach((title, i) => {
      const id = `VLPL${hash32(title).toString(36).padEnd(8, "x")}${Math.floor(pr() * 1e9).toString(36)}`;
      const src = dataset.songs[(i * 211) % dataset.songs.length]!;
      playlists.set(id, { id, title, subtitle: `YouTube Music • ${40 + i * 10} bài`, art: src.art, source: "yt", owner: "YouTube Music", local: false, count: 40 + i * 10 });
    });
  }
  const savedPlaylists = new Set<string>([...playlists.keys()].slice(0, 8));
  const savedAlbums = new Set<string>();
  const subscribed = new Set<string>();
  const blocked = new Set<string>();

  // ---- sessions and emit
  const sessions = new Set<Session>();
  const hashArt = (m: string) => `"src":"core:mock/${hash32(m).toString(36)}"`;
  const localizeArt = (json: string): string => (opts.remoteArt ? json : json.replace(/"src":"https:\/\/[^"]+"/g, hashArt));
  function rawSend(s: Session, json: string) {
    if (s.ws.readyState === WebSocket.OPEN) s.ws.send(localizeArt(json));
  }
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

  // ---- user albums (stateful)
  const userAlbums = new Map<string, UserAlbum>();
  let nextUa = dataset.userAlbums.length + 1;
  let nextEntry = 1;
  for (const u of dataset.userAlbums) {
    userAlbums.set(u.id, { id: u.id, title: u.title, pinned: u.pinned, cover: u.art?.src, entries: u.songIds.map((trackId) => ({ entryId: String(nextEntry++), trackId })) });
  }

  // ---- history (stateful)
  let history: HistoryEvent[] = dataset.history.slice();

  // ---- library
  const lib = {
    revision: 1,
    cache: new Map<string, any[]>(),
    pending: new Set<string>(),
    uaDirty: false,
    lastEmit: 0,
    timer: null as ReturnType<typeof setTimeout> | null,
  };
  function flushLibrary() {
    lib.timer = null;
    lib.lastEmit = Date.now();
    const lists = [...lib.pending];
    lib.pending.clear();
    if (lists.length) emit("library", "library.changed", { lists, revision: lib.revision });
    if (lib.uaDirty) { lib.uaDirty = false; emit("library", "userAlbums.changed", {}); }
  }
  /** bump the revision now; the event is coalesced to <= 4 Hz */
  function bumpLibrary(lists: string[], userAlbumsChanged = false) {
    lib.revision++;
    lib.cache.clear();
    for (const l of lists) lib.pending.add(l);
    if (userAlbumsChanged) lib.uaDirty = true;
    if (!lib.timer) lib.timer = setTimeout(flushLibrary, Math.max(0, LIBRARY_EMIT_GAP_MS - (Date.now() - lib.lastEmit)));
  }
  const counts = () => ({
    songs: dataset.songs.length,
    liked: dataset.songs.filter((s) => s.liked).length,
    downloaded: dataset.songs.filter((s) => s.download === "downloaded").length,
    albums: dataset.albums.length,
    artists: dataset.artists.length,
    playlists: savedPlaylists.size,
    userAlbums: userAlbums.size,
  });

  const uaCard = (u: UserAlbum) => ({
    id: u.id, title: u.title, subtitle: "Danh sách phát của bạn", source: "local" as const, local: true, count: u.entries.length,
    art: { src: u.cover ?? `core:playlist_covers/${u.id.replace(":", "-")}` }, pinned: u.pinned, revision: lib.revision,
  });
  const albumCard = ({ trackIds: _t, label: _l, ...a }: MockAlbum): AlbumCard => a;
  const historyTrack = (e: HistoryEvent) => ({ ...(registry.get(e.songId) ?? dataset.byId.get(e.songId)!), playedAt: e.playedAt, eventId: e.eventId });

  function userAlbumTracks(id: string): Track[] {
    const u = userAlbums.get(id);
    if (!u) throw notFound(`unknown list userAlbum:${id}`);
    return u.entries.map((e) => ({ ...(registry.get(e.trackId) ?? dataset.byId.get(e.trackId)!), setVideoId: e.entryId }));
  }

  const SONG_LISTS = new Set(["songs", "liked", "downloaded", "cached"]);
  function listItems(list: LocalList, sort: SortSpec, filter?: FilterSpec): any[] {
    const key = JSON.stringify([list, sort, filter, lib.revision]);
    const hit = lib.cache.get(key);
    if (hit) return hit;
    let items: any[];
    if (list === "songs") items = dataset.songs.filter((s) => !blocked.has(s.id));
    else if (list === "liked") items = dataset.songs.filter((s) => s.liked);
    else if (list === "downloaded" || list === "cached") items = dataset.songs.filter((s) => s.download === "downloaded");
    else if (list === "albums") items = dataset.albums.map(albumCard);
    else if (list === "artists") items = dataset.artists.slice();
    else if (list === "playlists") items = [...savedPlaylists].map((id) => playlists.get(id)!).filter(Boolean);
    else if (list === "history") items = history.map(historyTrack);
    else if (typeof list === "string" && list.startsWith("userAlbum:")) items = userAlbumTracks(list.slice("userAlbum:".length));
    else throw bad(`unknown list ${String(list)}`);

    const filterable = SONG_LISTS.has(list as string) || list === "history" || String(list).startsWith("userAlbum:");
    if (filter && filterable) {
      const text = filter.text ? strip(filter.text) : "";
      items = items.filter((s: Track) => {
        if (filter.source && s.source !== filter.source) return false;
        if (filter.downloaded !== undefined && (s.download === "downloaded") !== filter.downloaded) return false;
        if (filter.liked !== undefined && !!s.liked !== filter.liked) return false;
        if (filter.explicit !== undefined && !!s.explicit !== filter.explicit) return false;
        if (text && !strip(`${s.title} ${s.artists.map((a) => a.name).join(" ")} ${s.album?.title ?? ""}`).includes(text)) return false;
        return true;
      });
    } else if (filter?.text && !filterable) {
      const text = strip(filter.text);
      items = items.filter((x: any) => strip(`${x.title ?? x.name ?? ""}`).includes(text));
    }

    const dir = sort.desc ? -1 : 1;
    const idx = (x: any) => songIndex.get(x.id) ?? 0;
    const trackCmp = (a: Track, b: Track): number => {
      switch (sort.by) {
        case "added": return (a.addedAt ?? 0) - (b.addedAt ?? 0);
        case "title": return a.title.localeCompare(b.title, "vi");
        case "artist": return (a.artists[0]?.name ?? "").localeCompare(b.artists[0]?.name ?? "", "vi");
        case "album": return (a.album?.title ?? "").localeCompare(b.album?.title ?? "", "vi");
        case "duration": return (a.durationMs ?? 0) - (b.durationMs ?? 0);
        case "plays": return (dataset.plays[idx(a)] ?? 0) - (dataset.plays[idx(b)] ?? 0);
        case "lastPlayed": return (dataset.lastPlayed[idx(a)] ?? 0) - (dataset.lastPlayed[idx(b)] ?? 0);
        default: return 0;
      }
    };
    if (SONG_LISTS.has(list as string)) {
      if (sort.by !== "custom") items.sort((a, b) => dir * trackCmp(a, b) || idx(a) - idx(b));
    } else if (list === "history") {
      // newest first is the natural order; `desc:false` reverses it
      if (sort.by === "title") items.sort((a, b) => dir * trackCmp(a, b));
      else if (!sort.desc) items = items.slice().reverse();
    } else if (String(list).startsWith("userAlbum:")) {
      if (sort.by !== "custom" && sort.by !== "added") items.sort((a, b) => dir * trackCmp(a, b));
      else if (sort.by === "added" && sort.desc) items = items.slice().reverse();
    } else if (sort.by === "title" || sort.by === "artist") {
      items = items.slice().sort((a: any, b: any) => dir * String(a.title ?? a.name).localeCompare(String(b.title ?? b.name), "vi"));
    }
    if (lib.cache.size > 32) lib.cache.clear();
    lib.cache.set(key, items);
    return items;
  }

  // ---- player + queue simulation
  const rng = mulberry32(99);
  let qidCounter = 0;
  const newQid = () => `q${++qidCounter}`;
  const pl = {
    q: [] as QItem[],
    qRevision: 1,
    autoplay: false,
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
  const cur = () => (pl.index >= 0 ? pl.q[pl.index]?.track : undefined);
  const durOf = (t?: Track) => (t ? t.durationMs ?? 200_000 : 0);
  const posNow = () => {
    const d = durOf(cur());
    let p = pl.anchorPos + (pl.playing ? (Date.now() - pl.anchorAt) * pl.speed : 0);
    if (p > d) p = d;
    return p < 0 ? 0 : p;
  };
  const setPos = (ms: number) => { pl.anchorPos = Math.max(0, Math.min(ms, durOf(cur()))); pl.anchorAt = Date.now(); };

  const canNextNow = () =>
    pl.index >= 0 && (pl.index < pl.q.length - 1 || pl.repeat === "all" || pl.shuffle || (pl.autoplay && pl.repeat === "off"));
  function playerDelta(): PlayerStateDelta {
    const t = cur() ?? null;
    const delta: PlayerStateDelta = {
      track: t, playing: pl.playing, buffering: false, reconnecting: false, durMs: durOf(t ?? undefined),
      volume: pl.volume, muted: pl.muted, shuffle: pl.shuffle, repeat: pl.repeat, speed: pl.speed, pitch: pl.pitch,
      eq: { enabled: false, profileName: "Flat" },
      canPrev: pl.index > 0 || pl.repeat === "all",
      canNext: canNextNow(),
      output: { id: "default", name: "Loa mặc định", kind: "speaker" },
    } as PlayerStateDelta;
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

  // queue
  const qTrack = (x: QItem) => ({ ...x.track, qid: x.qid });
  const queueSnapshot = () => {
    const from = Math.max(0, pl.index - 5);
    return { total: pl.q.length, revision: pl.qRevision, currentIndex: pl.index, head: pl.q.slice(from, from + 50).map(qTrack) };
  };
  /** content = items changed (revision bump); otherwise only the current index moved */
  function emitQueue(content: boolean) {
    if (content) pl.qRevision++;
    emit("queue", "queue.changed", { revision: pl.qRevision, currentIndex: pl.index });
  }
  const toQ = (tracks: Track[]): QItem[] => tracks.map((track) => ({ qid: newQid(), track }));
  /** replace the queue; the caller then calls startAt() */
  function setQueue(tracks: Track[], title: string) {
    pl.q = toQ(tracks);
    pl.qRevision++;
    pl.contextTitle = title;
    pl.index = -1;
  }
  /** n tracks related to a seed: deterministic, not already in the queue */
  function relatedTracks(seed: Track | undefined, n: number, exclude?: Set<string>): Track[] {
    const out: Track[] = [];
    const base = hash32(seed?.id ?? "radio") % dataset.songs.length;
    for (let i = 0; out.length < n && i < dataset.songs.length; i++) {
      const t = dataset.songs[(base + i * 7 + 1) % dataset.songs.length]!;
      if (t.id === seed?.id || exclude?.has(t.id)) continue;
      out.push(t);
    }
    return out;
  }

  function startAt(i: number) {
    pl.index = i;
    pl.anchorPos = 0;
    pl.anchorAt = Date.now();
    pl.playing = true;
    emitQueue(false);
  }
  function advance(dir: 1 | -1, auto: boolean) {
    if (pl.q.length === 0) return;
    if (auto && pl.repeat === "one") { setPos(0); pl.playing = true; return emitState(); }
    let n = pl.index + dir;
    if (dir === 1 && pl.shuffle && pl.q.length > 1) {
      do { n = Math.floor(rng() * pl.q.length); } while (n === pl.index);
    } else if (n >= pl.q.length) {
      if (pl.repeat === "all") n = 0;
      else if (pl.autoplay) {
        // autoplay: append 5 related tracks and carry on
        const more = relatedTracks(cur(), 5, new Set(pl.q.map((x) => x.track.id)));
        for (const t of more) registry.set(t.id, t);
        pl.q.push(...toQ(more));
        emitQueue(true);
        n = pl.index + 1;
      } else { if (auto) { pl.anchorPos = durOf(cur()); pl.anchorAt = Date.now(); pl.playing = false; emitState(); } return; }
    } else if (n < 0) {
      if (pl.repeat === "all") n = pl.q.length - 1; else n = 0;
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
  function doPause() { if (!pl.playing) return; setPos(posNow()); pl.playing = false; emitState(); }
  function doResume() { if (pl.playing || pl.index < 0) return; if (posNow() >= durOf(cur())) setPos(0); pl.anchorAt = Date.now(); pl.playing = true; emitState(); }

  return {
    opts, artToken, caps, dataset, home, albumFixture, registry, homeAlbums, homeArtists, playlists, savedPlaylists, savedAlbums, subscribed, blocked,
    songIndex, sessions, emit, rawSend,
    lib, bumpLibrary, counts, listItems, userAlbums, uaCard, albumCard, historyTrack,
    nextUaId: () => `lp:${nextUa++}`, nextEntryId: () => String(nextEntry++), userAlbumTracks,
    getHistory: () => history, setHistory: (h: HistoryEvent[]) => { history = h; },
    historyNow: () => history[0]?.playedAt ?? NOW,
    pl, cur, durOf, posNow, setPos, playerDelta, playerSnapshot, emitPosition, emitState, queueSnapshot, qTrack, emitQueue, toQ, setQueue,
    relatedTracks, startAt, advance, doPause, doResume, rng,
    close() { clearInterval(tick); if (posTimer) clearTimeout(posTimer); if (lib.timer) clearTimeout(lib.timer); },
  };
}
