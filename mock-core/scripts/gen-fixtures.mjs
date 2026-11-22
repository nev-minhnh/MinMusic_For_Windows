// node mock-core/scripts/gen-fixtures.mjs  (deterministic; same seed -> byte-identical files)
//   mock-core/fixtures/browse/home.json, mock-core/fixtures/pages/album.json
//   tests/fixtures/home.json              (= the home fixture, passed to the real core as --fixture-home)
//   tests/fixtures/library-seed.json      (5,000 songs, 40 albums, 50 artists, 10 user albums, 2,000 history events;
//                                          M1-2b seed format, passed to the real core as --seed-library. Same data as the mock library)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDataset, mulberry32, remoteArt } from "../src/gen.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const browseDir = join(root, "mock-core", "fixtures", "browse");
const pagesDir = join(root, "mock-core", "fixtures", "pages");
const testFixtures = join(root, "tests", "fixtures");
for (const d of [browseDir, pagesDir, testFixtures]) mkdirSync(d, { recursive: true });
const r = mulberry32(777);
const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const rid = (n) => Array.from({ length: n }, () => B[Math.floor(r() * 64)]).join("");

const SONGS = [
  ["Chúng Ta Của Hiện Tại", "Sơn Tùng M-TP", 301], ["Có Chắc Yêu Là Đây", "Sơn Tùng M-TP", 242],
  ["Muộn Rồi Mà Sao Còn", "Sơn Tùng M-TP", 275], ["Đi Về Nhà", "Đen", 222], ["Mười Năm", "Đen", 248],
  ["Bước Qua Nhau", "Vũ.", 254], ["Nàng Thơ", "Hoàng Dũng", 252], ["Hơn Cả Yêu", "Đức Phúc", 238],
  ["See Tình", "Hoàng Thùy Linh", 187], ["Thức Giấc", "Da LAB", 301], ["Waiting For You", "MONO", 266],
  ["Ngày Đầu Tiên", "Đức Phúc", 232], ["Em Của Ngày Hôm Qua", "Sơn Tùng M-TP", 270],
  ["Có Hẹn Với Thanh Xuân", "MONSTAR", 259], ["Một Triệu Like", "Đen", 201], ["Chạy Ngay Đi", "Sơn Tùng M-TP", 249],
  ["Tình Yêu Màu Nắng", "Đoàn Thúy Trang", 224], ["Cưới Thôi", "Masew", 211], ["Phép Màu", "MAYDAYs", 236],
  ["Lạc Trôi", "Sơn Tùng M-TP", 232], ["Blinding Lights", "The Weeknd", 200], ["As It Was", "Harry Styles", 167],
  ["Flowers", "Miley Cyrus", 200], ["Anti-Hero", "Taylor Swift", 200], ["Yellow", "Coldplay", 269],
  ["Heat Waves", "Glass Animals", 238], ["Levitating", "Dua Lipa", 203], ["Cruel Summer", "Taylor Swift", 178],
  ["Good 4 U", "Olivia Rodrigo", 178], ["Espresso", "Sabrina Carpenter", 175],
];
const ALBUMS = [
  ["Sky Tour", "Sơn Tùng M-TP", 2020, "album"], ["Mười Năm", "Đen", 2022, "single"], ["Hoàng Thùy Linh: Link", "Hoàng Thùy Linh", 2021, "album"],
  ["Đức Phúc Acoustic", "Đức Phúc", 2023, "ep"], ["After Hours", "The Weeknd", 2020, "album"], ["Harry's House", "Harry Styles", 2022, "album"],
  ["Midnights", "Taylor Swift", 2022, "album"], ["Music of the Spheres", "Coldplay", 2021, "album"], ["Future Nostalgia", "Dua Lipa", 2020, "album"],
  ["Vũ.: Bảo Tàng Của Nuối Tiếc", "Vũ.", 2020, "album"],
];
const ARTISTS = ["Sơn Tùng M-TP", "Đen", "Hoàng Thùy Linh", "Đức Phúc", "Vũ.", "MONO", "The Weeknd", "Taylor Swift", "Coldplay", "Dua Lipa"];
const PLAYLISTS = [
  ["Nhạc Chill Cuối Tuần", "YouTube Music"], ["V-Pop Đang Hot", "Zing MP3"], ["Lofi Học Bài", "YouTube Music"], ["Nhạc Trẻ Hay Nhất", "NhacCuaTui"],
  ["Acoustic Việt", "YouTube Music"], ["Rap Việt Tuyển Chọn", "Zing MP3"], ["Nhạc Xưa Bất Hủ", "YouTube Music"], ["Top Hits Quốc Tế", "SoundCloud"],
];

const mkTrack = ([title, artist, secs], source, i) => ({
  t: "track", id: source === "yt" ? rid(11) : source === "zing" ? `zing:Z${rid(7).toUpperCase().replace(/[-_]/g, "A")}` : `${source}:${rid(9)}`,
  title, artists: [{ id: `UC${rid(22)}`, name: artist }], durationMs: secs * 1000, art: remoteArt(r, source), source,
  quality: source === "zing" ? { label: "320", lossless: false, kbps: 320 } : { label: "Opus 160", lossless: false, kbps: 160 },
  ...(i % 7 === 3 ? { explicit: true } : {}),
});
const mkAlbum = ([title, artist, year, kind], source = "yt") => ({
  t: "album", id: `MPREb_${rid(11)}`, title, artists: [{ id: `UC${rid(22)}`, name: artist }], year, art: remoteArt(r, source), source, kind,
});
const mkArtist = (name, source = "yt") => ({ t: "artist", id: `UC${rid(22)}`, name, art: remoteArt(r, source), subtitle: `${(1 + Math.floor(r() * 90)) / 10}Tr người đăng ký`, source });
const mkPlaylist = ([title, owner], i) => {
  const source = owner === "Zing MP3" ? "zing" : owner === "NhacCuaTui" ? "nct" : owner === "SoundCloud" ? "sc" : "yt";
  return { t: "playlist", id: source === "yt" ? `VLPL${rid(32)}` : `${source}:pl${rid(8)}`, title, subtitle: `${owner} • ${20 + i * 7} bài`, art: remoteArt(r, source), source, owner, local: false, count: 20 + i * 7 };
};

const home = {
  shelves: [
    { key: "quick", title: "Chọn nhanh", subtitle: "Bắt đầu nghe", layout: "quickPicks", items: SONGS.slice(0, 12).map((s, i) => mkTrack(s, "yt", i)) },
    { key: "again", title: "Nghe lại", layout: "cards", items: [...ALBUMS.slice(0, 4).map((a) => mkAlbum(a)), ...PLAYLISTS.slice(0, 4).map(mkPlaylist)] },
    { key: "zing", title: "BXH Zing MP3", subtitle: "Cập nhật mỗi giờ", layout: "chart", items: SONGS.slice(6, 16).map((s, i) => mkTrack(s, "zing", i)), more: { route: "charts", params: { source: "zing" } } },
    { key: "albums", title: "Album dành cho bạn", layout: "cards", items: ALBUMS.map((a) => mkAlbum(a)), more: { route: "browse", params: { browseId: "FEmusic_new_releases_albums" } } },
    { key: "artists", title: "Nghệ sĩ bạn có thể thích", layout: "cards", items: ARTISTS.slice(0, 8).map((n) => mkArtist(n)) },
    { key: "new", title: "Nhạc mới phát hành", layout: "rows", items: SONGS.slice(16, 26).map((s, i) => mkTrack(s, i % 2 ? "yt" : "zing", i)) },
    { key: "playlists", title: "Danh sách phát nổi bật", layout: "cards", items: PLAYLISTS.map(mkPlaylist) },
    { key: "intl", title: "Quốc tế đang thịnh hành", layout: "rows", items: SONGS.slice(20, 30).map((s, i) => mkTrack(s, "yt", i)) },
  ],
  chips: [["relax", "Thư giãn"], ["workout", "Tập luyện"], ["focus", "Tập trung"], ["commute", "Di chuyển"], ["party", "Tiệc tùng"], ["sad", "Buồn"]]
    .map(([key, title]) => ({ key, title, selected: false })),
  greeting: { key: "good_evening" },
  fromCache: true,
  next: null,
};
writeFileSync(join(browseDir, "home.json"), JSON.stringify(home, null, 2) + "\n");
writeFileSync(join(testFixtures, "home.json"), JSON.stringify(home, null, 2) + "\n");

const albumArt = remoteArt(r, "yt");
const aTracks = SONGS.slice(0, 12).map((s, i) => ({ ...mkTrack(s, "yt", i), t: undefined, art: albumArt, album: { id: "MPREb_mockAlbum01", title: "Sky Tour" } }));
for (const t of aTracks) delete t.t;
const album = {
  album: {
    id: "MPREb_mockAlbum01", title: "Sky Tour", artists: [{ id: `UC${rid(22)}`, name: "Sơn Tùng M-TP" }], year: 2020, art: albumArt, source: "yt", kind: "album",
    description: "Tuyển tập các ca khúc nổi bật, được tạo cho mock core (dữ liệu giả).", durationMs: aTracks.reduce((a, t) => a + t.durationMs, 0), trackCount: aTracks.length,
    label: "M-TP Entertainment", saved: false,
  },
  tracks: aTracks,
  otherVersions: [mkAlbum(["Sky Tour (Deluxe)", "Sơn Tùng M-TP", 2020, "album"]), mkAlbum(["Sky Tour (Instrumental)", "Sơn Tùng M-TP", 2021, "album"])].map(({ t, ...a }) => a),
  moreBy: { key: "moreBy", title: "Thêm từ Sơn Tùng M-TP", layout: "cards", items: ALBUMS.slice(0, 3).map((a) => mkAlbum([a[0] + " ", "Sơn Tùng M-TP", a[2], a[3]])) },
};
writeFileSync(join(pagesDir, "album.json"), JSON.stringify(album, null, 2) + "\n");

// ---- library seed (M1-2b format), from the same dataset the mock serves
const ds = generateDataset();
const seed = {
  songs: ds.songs.map((s, i) => ({
    id: s.id, title: s.title, artists: s.artists.map((a) => ({ id: a.id ?? "", name: a.name })),
    ...(s.album ? { album: { id: s.album.id ?? "", title: s.album.title } } : {}),
    durationMs: s.durationMs, thumbnailUrl: s.art?.src ?? "", liked: !!s.liked, addedAt: s.addedAt, plays: ds.plays[i],
  })),
  albums: ds.albums.map((a) => ({ id: a.id, title: a.title, artists: a.artists.map((x) => ({ name: x.name })), year: a.year, thumbnailUrl: a.art?.src ?? "" })),
  artists: ds.artists.map((a) => ({ id: a.id, name: a.name, thumbnailUrl: a.art?.src ?? "" })),
  userAlbums: ds.userAlbums.map((u) => ({ title: u.title, songIds: u.songIds, pinned: u.pinned })),
  history: ds.history.map((e) => ({ songId: e.songId, playedAt: e.playedAt, playTimeMs: e.playTimeMs })),
};
writeFileSync(join(testFixtures, "library-seed.json"), JSON.stringify(seed) + "\n");
console.log("fixtures written: mock-core/fixtures/{browse,pages}, tests/fixtures/{home,library-seed}.json");
