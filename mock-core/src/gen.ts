// Deterministic generators for the mock core: 5,000 songs, 40 albums, artists, user albums.
// Same seed -> byte-identical output.
import type { AlbumCard, ArtistCard, ArtistRef, Art, PlaylistCard, Quality, SourceId, Track } from "@minmusic/protocol";

export const DEFAULT_SEED = 20261122;
export const SONG_COUNT = 5000;
export const ALBUM_COUNT = 40;
export const TRACKS_PER_ALBUM = 12;
export const USER_ALBUM_COUNT = 10;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function randStr(r: () => number, n: number, alphabet = B64): string {
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(r() * alphabet.length)];
  return s;
}
function pick<T>(r: () => number, a: readonly T[]): T { return a[Math.floor(r() * a.length)]!; }

export const VN_ARTISTS = [
  "Sơn Tùng M-TP", "Hà Anh Tuấn", "Mỹ Tâm", "Đen Vâu", "Hoàng Thùy Linh", "Noo Phước Thịnh", "Bích Phương",
  "Phan Mạnh Quỳnh", "Min", "Erik", "Tăng Duy Tân", "AMEE", "Vũ.", "Chillies", "Orange", "Hòa Minzy",
  "Trúc Nhân", "Đức Phúc", "Jack - J97", "Văn Mai Hương", "Nguyễn Hà", "Thịnh Suy", "Wren Evans", "Bùi Anh Tuấn",
  "Trung Quân Idol", "Lê Hiếu", "Dương Domic", "Grey D", "Hứa Kim Tuyền", "MONO",
];
export const EN_ARTISTS = [
  "The Weeknd", "Taylor Swift", "Billie Eilish", "Ed Sheeran", "Dua Lipa", "Coldplay", "Imagine Dragons", "Adele",
  "Bruno Mars", "Ariana Grande", "Post Malone", "Lana Del Rey", "Radiohead", "Daft Punk", "Arctic Monkeys",
  "Olivia Rodrigo", "Harry Styles", "Sabrina Carpenter", "Tame Impala", "Lorde",
];
const VN_WORDS = [
  "Em", "Anh", "Mưa", "Nắng", "Đường", "Về", "Nhà", "Yêu", "Thương", "Nhớ", "Người", "Ta", "Đêm", "Sài Gòn",
  "Hà Nội", "Mùa Thu", "Gió", "Biển", "Chiều", "Ngày", "Xa", "Mãi Mãi", "Còn Đó", "Một Lần", "Cuối Cùng",
  "Tình", "Hoa", "Nước Mắt", "Giấc Mơ", "Bầu Trời", "Phố", "Quên", "Lặng Lẽ", "Đừng", "Bên Em", "Ngủ Quên",
];
const EN_WORDS = [
  "Midnight", "Heart", "Fire", "Summer", "Dancing", "Blue", "Gold", "Run", "Away", "Love", "Stay", "Light",
  "Dream", "Ocean", "City", "Lost", "Forever", "Echo", "Golden", "Hour", "Wild", "Silver", "Paradise", "Gravity",
];

function vnTitle(r: () => number): string {
  const n = 2 + Math.floor(r() * 3);
  const w: string[] = [];
  for (let i = 0; i < n; i++) w.push(pick(r, VN_WORDS));
  return w.join(" ");
}
function enTitle(r: () => number): string {
  const n = 1 + Math.floor(r() * 3);
  const w: string[] = [];
  for (let i = 0; i < n; i++) w.push(pick(r, EN_WORDS));
  return w.join(" ");
}

const SOURCE_TABLE: [SourceId, number][] = [["yt", 0.55], ["zing", 0.2], ["sc", 0.1], ["nct", 0.1], ["local", 0.05]];
function pickSource(r: () => number): SourceId {
  let x = r();
  for (const [s, p] of SOURCE_TABLE) { if (x < p) return s; x -= p; }
  return "yt";
}
function qualityFor(r: () => number, s: SourceId): Quality {
  switch (s) {
    case "yt": return r() < 0.7 ? { label: "Opus 160", lossless: false, kbps: 160 } : { label: "AAC 256", lossless: false, kbps: 256 };
    case "sc": return r() < 0.5 ? { label: "128", lossless: false, kbps: 128 } : { label: "AAC 160", lossless: false, kbps: 160 };
    case "zing": return r() < 0.15 ? { label: "Lossless", lossless: true } : r() < 0.5 ? { label: "320", lossless: false, kbps: 320 } : { label: "128", lossless: false, kbps: 128 };
    case "nct": return r() < 0.3 ? { label: "320", lossless: false, kbps: 320 } : { label: "128", lossless: false, kbps: 128 };
    default: return r() < 0.4 ? { label: "FLAC", lossless: true } : { label: "320", lossless: false, kbps: 320 };
  }
}

function idFor(r: () => number, s: SourceId, i: number): string {
  switch (s) {
    case "yt": return randStr(r, 11);
    case "sc": return `sc:${100000000 + Math.floor(r() * 899999999)}`;
    case "zing": return `zing:Z${randStr(r, 7, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")}`;
    case "nct": return `nct:${randStr(r, 10, "abcdefghijklmnopqrstuvwxyz0123456789")}`;
    default: return `local_${i}`;
  }
}

/** Real-shaped artwork URL for a source. `n` makes it unique per item. */
export function remoteArt(r: () => number, s: SourceId): Art {
  const px = pick(r, [226, 302, 544, 600]);
  switch (s) {
    case "yt": return r() < 0.5
      ? { src: `https://lh3.googleusercontent.com/${randStr(r, 64)}=w${px}-h${px}-l90-rj`, w: px, h: px }
      : { src: `https://i.ytimg.com/vi/${randStr(r, 11)}/hqdefault.jpg`, w: 480, h: 360 };
    case "zing": return { src: `https://photo-resize-zmp3.zmdcdn.me/w240_r1x1_jpeg/cover/${randStr(r, 1, "0123456789abcdef")}/${randStr(r, 1, "0123456789abcdef")}/${randStr(r, 32, "0123456789abcdef")}.jpg`, w: 240, h: 240 };
    case "sc": return { src: `https://i1.sndcdn.com/artworks-${randStr(r, 12, "0123456789abcdefghijklmnopqrstuv")}-${randStr(r, 6, "abcdefghijklmnop")}-t500x500.jpg`, w: 500, h: 500 };
    case "nct": return { src: `https://avatar-ex-swe.nixcdn.com/song/${randStr(r, 10, "0123456789")}/${randStr(r, 20, "abcdef0123456789")}.jpg`, w: 500, h: 500 };
    default: return { src: `core:local_tag/${randStr(r, 16, "0123456789abcdef")}` };
  }
}

export interface MockAlbum extends AlbumCard {
  trackIds: string[];
  label: string;
}

export interface Dataset {
  songs: Track[];
  albums: MockAlbum[];
  artists: ArtistCard[];
  userAlbums: (PlaylistCard & { pinned: boolean; revision: number })[];
  /** song index -> number of plays (for sort by plays) */
  plays: number[];
  lastPlayed: number[];
  byId: Map<string, Track>;
  likedIds: Set<string>;
}

export function generateDataset(seed = DEFAULT_SEED, songCount = SONG_COUNT): Dataset {
  const r = mulberry32(seed);
  const artistPool: ArtistRef[] = [...VN_ARTISTS, ...EN_ARTISTS].map((name) => ({ id: `UC${randStr(r, 22)}`, name }));
  const artists: ArtistCard[] = artistPool.map((a) => ({
    id: a.id!, name: a.name, source: "yt", subtitle: `${(1 + Math.floor(r() * 9000)) / 10}N người đăng ký`,
    art: remoteArt(r, "yt"),
  }));

  // albums first, so their tracks can reference them
  const albums: MockAlbum[] = [];
  for (let a = 0; a < ALBUM_COUNT; a++) {
    const vn = r() < 0.65;
    const ar = pick(r, vn ? artistPool.slice(0, VN_ARTISTS.length) : artistPool.slice(VN_ARTISTS.length));
    let src: SourceId = pickSource(r);
    if (src === "local") src = "yt";
    albums.push({
      id: src === "yt" ? `MPREb_${randStr(r, 11)}` : `${src}:alb${randStr(r, 8, "abcdefghijklmnopqrstuvwxyz0123456789")}`,
      title: vn ? vnTitle(r) : enTitle(r),
      artists: [ar],
      year: 2005 + Math.floor(r() * 21),
      art: remoteArt(r, src),
      source: src,
      kind: pick(r, ["album", "album", "ep", "single"] as const),
      trackIds: [],
      label: pick(r, ["Universal Music", "Sony Music", "Warner Music", "Vie Channel", "Independent", "Hy Vọng Music"]),
    });
  }

  const songs: Track[] = [];
  const plays: number[] = [];
  const lastPlayed: number[] = [];
  const likedIds = new Set<string>();
  const NOW = 1_795_000_000_000; // fixed reference time so output is deterministic
  for (let i = 0; i < songCount; i++) {
    const inAlbum = i < ALBUM_COUNT * TRACKS_PER_ALBUM;
    const album = inAlbum ? albums[i % ALBUM_COUNT]! : undefined;
    const vn = album ? album.artists[0]!.name && VN_ARTISTS.includes(album.artists[0]!.name) : r() < 0.65;
    const source: SourceId = album ? album.source : pickSource(r);
    const mainArtist = album ? album.artists[0]! : pick(r, artistPool.slice(vn ? 0 : VN_ARTISTS.length, vn ? VN_ARTISTS.length : undefined));
    const artistsList: ArtistRef[] = [mainArtist];
    if (!album && r() < 0.18) artistsList.push(pick(r, artistPool));
    const title = (vn ? vnTitle(r) : enTitle(r)) + (r() < 0.07 ? " (Remix)" : r() < 0.05 ? " (Live)" : "");
    const t: Track = {
      id: idFor(r, source, i),
      title,
      artists: artistsList,
      durationMs: 120_000 + Math.floor(r() * 240_000),
      art: album ? album.art : remoteArt(r, source),
      source,
      quality: qualityFor(r, source),
      explicit: r() < 0.08,
      addedAt: NOW - i * 3_600_000 - Math.floor(r() * 3_000_000),
    };
    if (album) t.album = { id: album.id, title: album.title };
    else if (r() < 0.4) t.album = { id: `MPREb_${randStr(r, 11)}`, title: vn ? vnTitle(r) : enTitle(r) };
    if (r() < 0.12) t.altSources = 1 + Math.floor(r() * 3);
    if (r() < 0.08) { t.liked = true; likedIds.add(t.id); }
    const dl = r();
    t.download = dl < 0.1 ? "downloaded" : dl < 0.12 ? "queued" : "none";
    if (source === "zing" && r() < 0.06) t.vip = true;
    if (source === "yt" && r() < 0.04) t.isVideo = true;
    if (r() < 0.5) t.playCountText = `${(0.1 + r() * 900).toFixed(1)}M lượt xem`;
    songs.push(t);
    plays.push(Math.floor(r() * r() * 400));
    lastPlayed.push(NOW - Math.floor(r() * 90 * 86_400_000));
    if (album) album.trackIds.push(t.id);
  }

  const userAlbums = [];
  for (let u = 0; u < USER_ALBUM_COUNT; u++) {
    userAlbums.push({
      id: `lp:${u + 1}`,
      title: pick(r, ["Nhạc buồn", "Chill cuối tuần", "Tập gym", "Đi làm", "Acoustic", "V-Pop 2024", "Lofi", "Nhạc Hoa", "Road trip", "Ngủ ngon"]) + (u >= 10 ? ` ${u}` : ""),
      subtitle: "Danh sách phát của bạn",
      source: "local" as SourceId,
      local: true,
      count: 20 + Math.floor(r() * 80),
      art: { src: `core:playlist_covers/lp-${u + 1}-${randStr(r, 6, "0123456789abcdef")}` },
      pinned: u < 3,
      revision: 1,
    });
  }

  const byId = new Map<string, Track>();
  for (const s of songs) byId.set(s.id, s);
  return { songs, albums, artists, userAlbums, plays, lastPlayed, byId, likedIds };
}
