// Search: suggestions (120 ms latency, a new call cancels the previous one on the same connection), results, history.
import type { Item, SourceId, Track } from "@minmusic/protocol";
import type { HandlerModule, MockState } from "../state.ts";
import { trackItem } from "../content.ts";
import { ApiErr, bad, parseCursor, strip } from "../util.ts";

const SUGGEST_LATENCY_MS = 120;
const PAGE_TRACKS = 20;
const SOURCES = ["yt", "sc", "zing", "nct", "local"];
const TYPES = ["all", "track", "album", "artist", "playlist"];

type Index = { tracks: string[]; artists: string[]; albums: string[]; playlists: string[]; hist: string[] };
const cache = new WeakMap<MockState, Index>();
function index(st: MockState): Index {
  let ix = cache.get(st);
  if (!ix) {
    ix = {
      tracks: st.dataset.songs.map((t) => strip(`${t.title} ${t.artists.map((a) => a.name).join(" ")} ${t.album?.title ?? ""}`)),
      artists: st.dataset.artists.map((a) => strip(a.name)),
      albums: st.dataset.albums.map((a) => strip(`${a.title} ${a.artists[0]?.name ?? ""}`)),
      playlists: [...st.playlists.values()].map((p) => strip(p.title)),
      hist: [],
    };
    cache.set(st, ix);
  }
  return ix;
}

const history = new WeakMap<MockState, string[]>();
const hist = (st: MockState) => {
  let h = history.get(st);
  if (!h) { h = ["sơn tùng", "lofi chill", "đen vâu", "nhạc buồn", "the weeknd"]; history.set(st, h); }
  return h;
};

function matches(st: MockState, q: string, source: string, type: string) {
  const nq = strip(q).trim();
  const ix = index(st);
  const okSrc = (s: SourceId) => source === "all" || source === s;
  const tracks: Track[] = [];
  if (type === "all" || type === "track") {
    for (let i = 0; i < ix.tracks.length; i++) if (ix.tracks[i]!.includes(nq) && okSrc(st.dataset.songs[i]!.source)) tracks.push(st.dataset.songs[i]!);
  }
  const artists = type === "all" || type === "artist" ? st.dataset.artists.filter((a, i) => ix.artists[i]!.includes(nq) && okSrc(a.source)) : [];
  const albums = type === "all" || type === "album" ? st.dataset.albums.filter((a, i) => ix.albums[i]!.includes(nq) && okSrc(a.source)) : [];
  const pls = type === "all" || type === "playlist" ? [...st.playlists.values()].filter((p, i) => ix.playlists[i]!.includes(nq) && okSrc(p.source)) : [];
  return { tracks, artists, albums, pls };
}

export const handlers: HandlerModule["handlers"] = {
  "search.suggest": (p, { s, st }) => {
    if (typeof p?.q !== "string") throw bad("q: string required");
    const q: string = p.q;
    return new Promise((resolve, reject) => {
      s.cancelSuggest?.(); // the previous call of this connection answers `cancelled`
      const t = setTimeout(() => {
        s.cancelSuggest = undefined;
        const nq = strip(q).trim();
        const h = hist(st).filter((x) => !nq || strip(x).startsWith(nq) || strip(x).includes(nq)).slice(0, 3);
        const ix = index(st);
        const artists = st.dataset.artists.filter((_a, i) => nq && ix.artists[i]!.includes(nq)).slice(0, 2);
        const tracks: Track[] = [];
        if (nq) for (let i = 0; i < ix.tracks.length && tracks.length < 2; i++) if (ix.tracks[i]!.includes(nq)) tracks.push(st.dataset.songs[i]!);
        const extra = nq ? [`${q} remix`, `${q} lyrics`, `${q} live`].filter((x) => !h.includes(x)) : [];
        const queries = [...h, ...extra].slice(0, 4);
        const items: Item[] = [...artists.map((a) => ({ t: "artist" as const, ...a })), ...tracks.map(trackItem)];
        const room = 8 - queries.length;
        resolve({ queries, items: items.slice(0, Math.max(0, room)) });
      }, SUGGEST_LATENCY_MS);
      s.cancelSuggest = () => {
        clearTimeout(t);
        s.cancelSuggest = undefined;
        reject(new ApiErr("cancelled", "superseded by a newer search.suggest"));
      };
    });
  },

  "search.run": (p, { st }) => {
    const q = typeof p?.q === "string" ? p.q.trim() : "";
    if (!q) throw bad("q: non-empty string required");
    const source = p.source ?? "all";
    const type = p.type ?? "all";
    if (source !== "all" && !SOURCES.includes(source)) throw bad("source");
    if (!TYPES.includes(type)) throw bad("type");
    const page = parseCursor(p.cursor, "search"); // 0 = first page, 1 = second
    if (page > 1) throw bad("stale cursor");
    const m = matches(st, q, source, type);
    const more = (t: string) => ({ route: "search", params: { q, type: t, ...(source !== "all" ? { source } : {}) } });

    if (page === 1) {
      const tracks = m.tracks.slice(PAGE_TRACKS, PAGE_TRACKS * 2);
      return { sections: tracks.length ? [{ type: "track", title: "Bài hát", items: tracks.map(trackItem) }] : [], next: null };
    }
    // record in history (front, deduplicated, 20 max)
    const h = hist(st);
    const at = h.findIndex((x) => strip(x) === strip(q));
    if (at >= 0) h.splice(at, 1);
    h.unshift(q);
    if (h.length > 20) h.length = 20;

    const sections: { type: string; title: string; items: Item[]; more?: { route: string; params: object } }[] = [];
    const limit = type === "all" ? { track: PAGE_TRACKS, artist: 6, album: 8, playlist: 6 } : { track: PAGE_TRACKS, artist: 40, album: 40, playlist: 40 };
    if (m.tracks.length) sections.push({ type: "track", title: "Bài hát", items: m.tracks.slice(0, limit.track).map(trackItem), ...(type === "all" && m.tracks.length > limit.track ? { more: more("track") } : {}) });
    if (m.artists.length) sections.push({ type: "artist", title: "Nghệ sĩ", items: m.artists.slice(0, limit.artist).map((a) => ({ t: "artist" as const, ...a })), ...(type === "all" && m.artists.length > limit.artist ? { more: more("artist") } : {}) });
    if (m.albums.length) sections.push({ type: "album", title: "Album", items: m.albums.slice(0, limit.album).map((a) => ({ t: "album" as const, ...st.albumCard(a) })), ...(type === "all" && m.albums.length > limit.album ? { more: more("album") } : {}) });
    if (m.pls.length) sections.push({ type: "playlist", title: "Danh sách phát", items: m.pls.slice(0, limit.playlist).map((x) => ({ t: "playlist" as const, ...x })), ...(type === "all" && m.pls.length > limit.playlist ? { more: more("playlist") } : {}) });

    let top: (Item & { sources: SourceId[] }) | undefined;
    if (type === "all") {
      const nq = strip(q);
      const exact = m.artists.find((a) => strip(a.name).includes(nq)) ?? m.artists[0];
      if (exact) {
        const own = m.tracks.filter((t) => t.artists[0]?.name === exact.name);
        top = { t: "artist", ...exact, sources: [...new Set<SourceId>(["yt", ...own.map((t) => t.source)])].slice(0, 4) };
      } else if (m.tracks[0]) {
        const t0 = m.tracks[0];
        top = { t: "track", ...t0, sources: [...new Set<SourceId>([t0.source, ...(t0.altSources ? (["yt", "zing"] as SourceId[]) : [])])] };
      }
    }
    return { ...(top ? { top } : {}), sections, next: m.tracks.length > PAGE_TRACKS ? "search:1" : null };
  },

  "search.history.list": (_p, { st }) => ({ items: hist(st).slice() }),
  "search.history.remove": (p, { st }) => {
    const h = hist(st);
    if (p?.q === undefined) h.length = 0;
    else if (typeof p.q !== "string") throw bad("q: string");
    else { const i = h.findIndex((x) => x === p.q); if (i >= 0) h.splice(i, 1); }
    return {};
  },
};
