// Local stand-in for ui/src/core (M0-D). Same signatures: client.call, client.sub, artUrl.
// Replace the import in ../lib/core.ts with "../core/index" when M0-D is merged.
import type { Art, Client, Track, PlayerState, SourceId, Item, Shelf, WindowResult, AlbumCard } from "../lib/types";

const SONGS: [string, string, SourceId, string, number, number, number][] = [
  ["See Tình", "Hoàng Thùy Linh", "zing", "FLAC", 185, 6, 2],
  ["Nơi Này Có Anh", "Sơn Tùng M-TP", "yt", "Opus 160", 260, 8, 2],
  ["Waiting For You", "MONO", "nct", "320", 265, 3, 1],
  ["Lạ Lùng", "Vũ.", "yt", "AAC 256", 261, 11, 0],
  ["Bài Này Chill Phết", "Đen, MIN", "sc", "", 276, 5, 1],
  ["Tháng Tư Là Lời Nói Dối Của Em", "Hà Anh Tuấn", "zing", "320", 305, 9, 1],
  ["Chúng Ta Của Hiện Tại", "Sơn Tùng M-TP", "yt", "Opus 160", 301, 1, 2],
  ["Đưa Em Về Nhàa", "GREY D, Chillies", "nct", "320", 226, 10, 0],
  ["Nàng Thơ", "Hoàng Dũng", "zing", "320", 254, 4, 1],
  ["Đi Về Nhà", "Đen, JustaTee", "yt", "Opus 160", 207, 12, 1],
  ["Ngày Đầu Tiên", "Đức Phúc", "nct", "320", 232, 7, 0],
  ["Có Hẹn Với Thanh Xuân", "MONSTAR", "zing", "FLAC", 204, 2, 1],
];
const ALBUMS = ["Đĩa đơn", "Lạ Lùng", "LINK", "22", "Chill cuối tuần", "Nhạc đêm khuya"];
const ADDED = ["Hôm nay", "Hôm qua", "12/11", "13/11", "14/11", "15/11", "18/11"];
const TOTAL = 5000;

export function makeTrack(i: number): Track {
  const s = SONGS[i % SONGS.length];
  const round = Math.floor(i / SONGS.length);
  return {
    id: "mock" + i,
    title: round ? `${s[0]} ${round + 1}` : s[0],
    artists: s[1].split(", ").map((name) => ({ name })),
    album: { id: "alb" + (i % ALBUMS.length), title: ALBUMS[i % ALBUMS.length] },
    durationMs: (s[4] + (i % 7) * 3) * 1000,
    art: { src: "grad:g" + s[5] },
    source: s[2],
    quality: s[3] ? { label: s[3], lossless: s[3] === "FLAC" } : undefined,
    altSources: s[6],
    liked: i % 5 === 0,
    addedText: ADDED[Math.floor(i / 3) % ADDED.length],
  };
}

const UA = [
  ["Chill cuối tuần", 24, 5],
  ["Nhạc đêm khuya", 18, 3],
  ["Rap Việt mỗi ngày", 40, 12],
  ["Lái xe đường dài", 56, 9],
  ["Acoustic nhẹ nhàng", 21, 11],
  ["Cà phê sáng", 15, 4],
] as const;

function playlist(id: string, title: string, subtitle: string, g: number, local: boolean, source: SourceId = "local"): Item {
  return { t: "playlist", id, title, subtitle, art: { src: "grad:g" + g }, source, local };
}

function homeShelves(): Shelf[] {
  const qp: Item[] = [
    playlist("lp:0", "Bài hát đã thích", "", 6, true),
    playlist("lp:1", "Chill cuối tuần", "", 5, true),
    playlist("zing:top100", "Top 100 V-Pop", "", 8, false, "zing"),
    playlist("lp:2", "Nhạc đêm khuya", "", 3, true),
    playlist("lp:3", "Rap Việt mỗi ngày", "", 12, true),
    playlist("lp:4", "Đã tải · FLAC", "", 11, true),
    playlist("zing:indie", "Indie Việt", "", 1, false, "zing"),
    playlist("lp:5", "Lofi học bài", "", 9, true),
  ];
  const mine: Item[] = [
    playlist("lp:0", "Chill cuối tuần", "Album của tôi · 24 bài", 5, true),
    playlist("zing:vpop", "V-Pop hôm nay", "Playlist · MinMusic", 8, false, "yt"),
    playlist("zing:indie", "Indie Việt", "Playlist · Zing MP3", 1, false, "zing"),
    playlist("nct:ballad", "Ballad buồn", "Playlist · NhacCuaTui", 10, false, "nct"),
    playlist("yt:rap", "Rap Việt nổi bật", "Playlist · YouTube Music", 12, false, "yt"),
    playlist("sc:lofi", "Lofi học bài", "Playlist · SoundCloud", 9, false, "sc"),
    playlist("lp:4", "Acoustic nhẹ nhàng", "Album của tôi · 21 bài", 11, true),
    playlist("zing:kpop", "Hàn Quốc hôm nay", "Playlist · Zing MP3", 6, false, "zing"),
    playlist("yt:jazz", "Jazz buổi sáng", "Playlist · YouTube Music", 4, false, "yt"),
  ];
  const second: Item[] = mine.slice().reverse().map((x) => ({ ...x }) as Item);
  return [
    { key: "quick", title: "quick", layout: "quickPicks", items: qp },
    { key: "foryou", title: "Dành cho bạn", layout: "cards", items: mine },
    { key: "recent", title: "Nghe gần đây", layout: "cards", items: second },
  ];
}

function chart(source: string) {
  const order = source === "zing" ? [0, 2, 5, 1, 11, 8, 7, 3, 10, 9] : source === "nct" ? [2, 7, 10, 0, 5, 9, 1, 3, 8, 11] : [1, 6, 3, 9, 0, 4, 11, 2, 5, 7];
  const trends: any[] = [["up", 2], ["same"], ["down", 1], ["up", 5], ["new"], ["up", 1], ["down", 2], ["same"], ["up", 3], ["down", 4]];
  return {
    source,
    title: "Bảng xếp hạng Việt Nam",
    updatedAt: Date.now(),
    tabs: [],
    items: order.map((n, k) => ({ ...makeTrack(n), rank: k + 1, trend: trends[k][0], delta: trends[k][1] })),
  };
}

const playerState: PlayerState = {
  track: makeTrack(0),
  playing: true,
  buffering: false,
  reconnecting: false,
  posMs: 72_000,
  durMs: 185_000,
  bufMs: 185_000,
  at: Date.now(),
  volume: 0.7,
  muted: false,
  shuffle: true,
  repeat: "off",
  speed: 1,
  pitch: 0,
  context: { title: "Chill cuối tuần" },
  eq: { enabled: true, profileName: "Giọng hát" },
  quality: { label: "FLAC", lossless: true },
  source: "zing",
  canPrev: true,
  canNext: true,
};

type Listener = (name: string, data: any) => void;
const listeners = new Map<string, Set<Listener>>();
let anchor = { pos: playerState.posMs, t: performance.now() };

function curPos() {
  return playerState.playing ? Math.min(playerState.durMs, anchor.pos + (performance.now() - anchor.t)) : anchor.pos;
}
function emitPlayer() {
  playerState.posMs = Math.round(curPos());
  playerState.at = Date.now();
  const l = listeners.get("player");
  if (!l) return;
  l.forEach((fn) => fn("player.state", { ...playerState }));
}
function setPos(ms: number) {
  anchor = { pos: ms, t: performance.now() };
  emitPlayer();
}
function playIndex(i: number, ctxTitle?: string) {
  const tr = makeTrack(i);
  playerState.track = tr;
  playerState.durMs = tr.durationMs ?? 200_000;
  playerState.quality = tr.quality;
  playerState.source = tr.source;
  playerState.playing = true;
  if (ctxTitle) playerState.context = { title: ctxTitle };
  setPos(0);
}
function trackIndex(): number {
  const n = Number(playerState.track?.id.replace("mock", ""));
  return Number.isFinite(n) ? n : 0;
}
let revision = 1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callImpl(m: string, p: any = {}): Promise<any> {
  {
    switch (m) {
      case "home.get":
        await sleep(8);
        return { shelves: homeShelves(), chips: [], greeting: { key: "good_evening" }, fromCache: false, next: null };
      case "charts.get":
        await sleep(5);
        return chart(p.source ?? "zing");
      case "library.counts":
        return { songs: TOTAL, liked: 342, downloaded: 1248, albums: 40, artists: 60, playlists: 10, userAlbums: 6 };
      case "library.window": {
        await sleep(12);
        const off = p.offset ?? 0;
        const limit = Math.min(p.limit ?? 100, 100);
        const items: Track[] = [];
        for (let i = off; i < Math.min(TOTAL, off + limit); i++) items.push(makeTrack(i));
        return { total: TOTAL, revision, offset: off, items } satisfies WindowResult<Track>;
      }
      case "userAlbum.list":
        return { items: UA.map((a, i) => ({ id: "lp:" + i, title: a[0], subtitle: `Album của tôi · ${a[1]} bài`, art: { src: "grad:g" + a[2] }, source: "local", local: true, count: a[1], pinned: true, revision: 1 })) };
      case "album.get": {
        await sleep(6);
        const idx = Number(String(p.id).replace(/\D/g, "")) || 0;
        const ua = UA[idx % UA.length];
        const tracks = Array.from({ length: 12 }, (_, k) => makeTrack(idx * 12 + k));
        const album: AlbumCard & any = {
          id: p.id, title: ua[0], artists: [{ name: "Tạo bởi bạn" }], art: { src: "grad:g" + ua[2] }, source: "local", kind: "album",
          durationMs: tracks.reduce((s, t) => s + (t.durationMs ?? 0), 0), trackCount: 12, year: 2026, saved: true,
        };
        return { album, tracks };
      }
      case "player.play": {
        const ctx = p.context ?? {};
        let i = 0;
        if (p.startId) i = Number(String(p.startId).replace("mock", "")) || 0;
        else if (p.startIndex != null) i = p.startIndex;
        playIndex(i, ctx.title);
        return {};
      }
      case "player.toggle":
        playerState.playing ? ((anchor = { pos: curPos(), t: performance.now() }), (playerState.playing = false)) : ((anchor.t = performance.now()), (playerState.playing = true));
        emitPlayer();
        return {};
      case "player.pause":
        anchor = { pos: curPos(), t: performance.now() };
        playerState.playing = false;
        emitPlayer();
        return {};
      case "player.resume":
        anchor.t = performance.now();
        playerState.playing = true;
        emitPlayer();
        return {};
      case "player.next":
        playIndex(trackIndex() + 1);
        return {};
      case "player.prev":
        playIndex(Math.max(0, trackIndex() - 1));
        return {};
      case "player.seek":
        setPos(p.ms);
        return {};
      case "player.seekPercent":
        setPos((p.pct / 100) * playerState.durMs);
        return {};
      case "player.setShuffle":
        playerState.shuffle = p.on;
        emitPlayer();
        return {};
      case "player.cycleRepeat":
        playerState.repeat = playerState.repeat === "off" ? "all" : playerState.repeat === "all" ? "one" : "off";
        emitPlayer();
        return {};
      case "track.like":
        if (playerState.track) playerState.track = { ...playerState.track, liked: p.liked };
        emitPlayer();
        return { liked: p.liked };
      default:
        return {};
    }
  }
}
export const client: Client = {
  call: callImpl as Client["call"],
  sub(topic, _params, onEvent) {
    let set = listeners.get(topic);
    if (!set) listeners.set(topic, (set = new Set()));
    set.add(onEvent);
    if (topic === "player") queueMicrotask(() => onEvent("player.snapshot", { ...playerState, posMs: Math.round(curPos()), at: Date.now() }));
    return () => set!.delete(onEvent);
  },
};

// auto-advance when the track ends
setInterval(() => {
  if (playerState.playing && curPos() >= playerState.durMs - 50) playIndex(trackIndex() + 1);
}, 500);

const BUCKETS = [64, 128, 256, 384, 512, 768, 1080];
export function artUrl(art: Art | undefined, cssPx: number): string {
  if (!art) return "";
  const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  const px = Math.ceil(cssPx * dpr);
  const b = BUCKETS.find((x) => x >= px) ?? 1080;
  if (art.src.startsWith("grad:")) return art.src;
  if (art.src.startsWith("core:")) return `http://127.0.0.1:0/art/${art.src.slice(5)}?w=${b}`;
  return art.src;
}
