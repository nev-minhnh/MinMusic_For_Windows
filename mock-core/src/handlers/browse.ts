// Home, charts, browse pages, moods. Deterministic: every generated shelf derives from the seeded dataset.
import type { ChartTrack, GreetingKey, Shelf, SourceId, Track } from "@minmusic/protocol";
import type { HandlerModule, MockState } from "../state.ts";
import { trackItem } from "../content.ts";
import { bad, hash32, parseCursor, reqStr } from "../util.ts";

export const MOODS = [
  ["relax", "Thư giãn", "#4f8a8b"], ["workout", "Tập luyện", "#d1495b"], ["focus", "Tập trung", "#2e4057"], ["commute", "Di chuyển", "#6a994e"],
  ["party", "Tiệc tùng", "#e07a5f"], ["sad", "Buồn", "#3d405b"], ["romance", "Lãng mạn", "#c9184a"], ["sleep", "Ngủ ngon", "#264653"],
  ["rain", "Ngày mưa", "#457b9d"], ["morning", "Buổi sáng", "#f4a261"], ["gaming", "Chơi game", "#7b2cbf"], ["travel", "Du lịch", "#2a9d8f"],
  ["vpop", "V-Pop", "#e63946"], ["rap", "Rap Việt", "#1d3557"], ["indie", "Indie", "#8d99ae"], ["ballad", "Ballad", "#b56576"],
  ["edm", "EDM", "#7209b7"], ["acoustic", "Acoustic", "#bc6c25"], ["lofi", "Lo-fi", "#5f6f52"], ["classic", "Nhạc xưa", "#6d597a"],
  ["kpop", "K-Pop", "#ff6b9d"], ["usuk", "US-UK", "#3a86ff"], ["movie", "Nhạc phim", "#555b6e"], ["kids", "Thiếu nhi", "#ffb703"],
] as const;

const greeting = (): GreetingKey => {
  const h = new Date().getHours();
  return h < 5 ? "good_night" : h < 12 ? "good_morning" : h < 18 ? "good_afternoon" : h < 22 ? "good_evening" : "good_night";
};

/** n consecutive items from a list, wrapping, starting at a hash of the seed */
function take<T>(list: T[], seed: string, n: number): T[] {
  const out: T[] = [];
  const start = hash32(seed) % list.length;
  for (let i = 0; i < n && i < list.length; i++) out.push(list[(start + i * 3) % list.length]!);
  return out;
}

/** 4 generated shelves for a chip or a "more" page */
export function generatedShelves(st: MockState, seed: string, title: string): Shelf[] {
  const { dataset } = st;
  const tracks = take(dataset.songs, `${seed}:t`, 12);
  const rows = take(dataset.songs, `${seed}:r`, 10);
  const albums = take(dataset.albums, `${seed}:a`, 8);
  const artists = take(dataset.artists, `${seed}:s`, 8);
  const pls = take([...st.playlists.values()], `${seed}:p`, 8);
  return [
    { key: `${seed}-quick`, title, subtitle: "Dành cho bạn", layout: "quickPicks", items: tracks.map(trackItem) },
    { key: `${seed}-albums`, title: `Album ${title.toLowerCase()}`, layout: "cards", items: albums.map((a) => ({ t: "album" as const, ...st.albumCard(a) })) },
    { key: `${seed}-artists`, title: "Nghệ sĩ gợi ý", layout: "cards", items: artists.map((a) => ({ t: "artist" as const, ...a })) },
    { key: `${seed}-rows`, title: "Nghe tiếp", layout: "rows", items: rows.map(trackItem) },
    { key: `${seed}-playlists`, title: "Danh sách phát nổi bật", layout: "cards", items: pls.map((p) => ({ t: "playlist" as const, ...p })) },
  ];
}

const CHART_TABS: Record<string, { key: string; title: string }[]> = {
  zing: [{ key: "vn", title: "Việt Nam" }, { key: "us", title: "US-UK" }, { key: "kr", title: "K-Pop" }],
  nct: [{ key: "vn", title: "Việt Nam" }, { key: "us", title: "Âu Mỹ" }],
  yt: [{ key: "trending", title: "Thịnh hành" }, { key: "vn", title: "Việt Nam" }],
};
const CHART_TITLES: Record<string, string> = { zing: "Zing Chart", nct: "NCT Top 20", yt: "YouTube Music Charts" };

export function chartRows(st: MockState, source: SourceId, key: string): ChartTrack[] {
  let pool: Track[] = st.dataset.songs.filter((s) => s.source === source);
  if (pool.length < 120) pool = st.dataset.songs;
  const start = hash32(`${source}:${key}`) % (pool.length - 100);
  return pool.slice(start, start + 100).map((t, i) => {
    const h = hash32(`${t.id}:${key}`) % 10;
    const trend: ChartTrack["trend"] = h < 4 ? "up" : h < 7 ? "down" : h < 9 ? "same" : "new";
    const row: ChartTrack = { ...t, rank: i + 1, trend };
    if (trend === "up" || trend === "down") row.delta = 1 + (hash32(`${t.id}:d`) % 9);
    return row;
  });
}

export const handlers: HandlerModule["handlers"] = {
  "home.get": (p, { st, emit }) => {
    const chip = typeof p?.chip === "string" && p.chip ? p.chip : undefined;
    if (chip && !st.home.chips.some((c) => c.key === chip)) throw bad(`unknown chip ${chip}`);
    if (p?.refresh) setTimeout(() => emit("app", "home.updated", { shelves: st.home.shelves }), 600);
    const shelves = chip ? generatedShelves(st, `chip-${chip}`, st.home.chips.find((c) => c.key === chip)!.title) : st.home.shelves;
    return {
      shelves, chips: st.home.chips.map((c) => ({ ...c, selected: c.key === chip })), greeting: { key: greeting() }, fromCache: true,
      next: "home:1",
    };
  },
  /** 3 pages, then next:null */
  "home.more": (p, { st }) => {
    const n = parseCursor(reqStr(p, "cursor"), "home");
    if (n < 1 || n > 3) throw bad("stale cursor");
    return { shelves: generatedShelves(st, `more-${n}`, ["Mới phát hành", "Thịnh hành", "Có thể bạn thích"][n - 1]!), next: n < 3 ? `home:${n + 1}` : null };
  },
  "charts.get": (p, { st }) => {
    const source = p?.source;
    if (source !== "zing" && source !== "nct" && source !== "yt") throw bad("source: zing|nct|yt");
    const tabs = CHART_TABS[source]!;
    const key = typeof p.key === "string" && p.key ? p.key : tabs[0]!.key;
    if (!tabs.some((t) => t.key === key)) throw bad(`unknown chart key ${key}`);
    return { source, title: `${CHART_TITLES[source]} - ${tabs.find((t) => t.key === key)!.title}`, updatedAt: Math.floor(Date.now() / 3_600_000) * 3_600_000, tabs, items: chartRows(st, source, key) };
  },
  "browse.page": (p, { st }) => {
    const browseId = reqStr(p, "browseId");
    const mood = MOODS.find((m) => m[0] === p?.params || m[0] === browseId);
    const title = mood ? mood[1] : `Khám phá ${browseId.slice(0, 24)}`;
    return { title, shelves: generatedShelves(st, `browse-${browseId}-${p?.params ?? ""}`, title).slice(0, 4), next: null };
  },
  "moods.list": () => ({ items: MOODS.map(([key, title, color]) => ({ key, title, color })) }),
};
