// Library windows, likes/saves, track info, user albums (stateful with revision + conflict), history, stats.
import type { AlbumCard, ArtistCard, LocalList, SortSpec, SourceOption, Track } from "@minmusic/protocol";
import type { HandlerModule, MockState } from "../state.ts";
import { ApiErr, bad, isObj, notFound, reqBool, reqInt, reqNum, reqStr, reqStrArr } from "../util.ts";

function windowArgs(p: any) {
  if (!isObj(p)) throw bad("params required");
  const offset = reqInt(p, "offset", 0);
  const limit = reqInt(p, "limit", 1, 200);
  if (!isObj(p.sort) || typeof p.sort.by !== "string" || typeof p.sort.desc !== "boolean") throw bad("sort required");
  if (typeof p.list !== "string") throw bad("list required");
  return { offset, limit, list: p.list as LocalList, sort: p.sort as SortSpec, filter: p.filter };
}

const trackOf = (st: MockState, id: string): Track => {
  const t = st.registry.get(id);
  if (!t) throw notFound(`track ${id}`);
  return t;
};

/** i18n keys w2_hist_*; the UI translates them. Buckets are relative to the newest event (the mock has a fixed clock). */
const DAY = 86_400_000;
function historyGroups(items: { playedAt: number }[], ref: number): { label: string; offset: number }[] {
  const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = startOfDay(ref);
  const bucket = (t: number) => (t >= today ? "w2_hist_today" : t >= today - DAY ? "w2_hist_yesterday" : t >= today - 7 * DAY ? "w2_hist_week" : t >= today - 30 * DAY ? "w2_hist_month" : "w2_hist_older");
  const groups: { label: string; offset: number }[] = [];
  items.forEach((it, i) => { const b = bucket(it.playedAt); if (groups[groups.length - 1]?.label !== b) groups.push({ label: b, offset: i }); });
  return groups;
}

function uaOf(st: MockState, id: string) {
  const u = st.userAlbums.get(id);
  if (!u) throw notFound(`userAlbum ${id}`);
  return u;
}
const touchUa = (st: MockState, id: string) => st.bumpLibrary([`userAlbum:${id}`, "playlists"], true);

function detailsFor(st: MockState, t: Track) {
  const lossless = !!t.quality?.lossless;
  const options: SourceOption[] = [{ source: t.source, id: t.id, quality: t.quality ?? { label: "128", lossless: false }, auto: true, available: true }];
  for (let i = 0; i < (t.altSources ?? 0); i++) {
    const src = (["yt", "zing", "sc", "nct"] as const).filter((s) => s !== t.source)[i % 3]!;
    options.push({ source: src, id: `${src === "yt" ? "" : src + ":"}${t.id.replace(/^[a-z]+:/, "")}`, quality: { label: "128", lossless: false }, auto: false, available: i !== 1, ...(i === 1 ? { hint: "region" as const } : {}) });
  }
  return {
    options,
    details: {
      codec: lossless ? "flac" : t.quality?.label.startsWith("Opus") ? "opus" : "aac",
      ...(t.quality?.kbps ? { bitrate: t.quality.kbps * 1000 } : {}), sampleRate: lossless ? 44100 : 48000, loudnessDb: -7.4,
      ...(t.download === "downloaded" ? { fileSize: Math.round(((t.durationMs ?? 200_000) / 1000) * (t.quality?.kbps ?? 160) * 125), path: `C:\\MockMusic\\${t.id.replace(/[^A-Za-z0-9]/g, "_")}.${lossless ? "flac" : "m4a"}` } : {}),
      sources: options,
    },
  };
}

export const handlers: HandlerModule["handlers"] = {
  "library.counts": (_p, { st }) => st.counts(),
  "library.window": (p, { st }) => {
    const { offset, limit, list, sort, filter } = windowArgs(p);
    const items = st.listItems(list, sort, filter);
    return { total: items.length, revision: st.lib.revision, offset, items: items.slice(offset, offset + limit) };
  },
  "library.indexOf": (p, { st }) => {
    if (!isObj(p) || typeof p.list !== "string" || !isObj(p.sort)) throw bad("list and sort required");
    const id = reqStr(p, "id");
    const index = st.listItems(p.list as LocalList, p.sort as SortSpec, p.filter).findIndex((x: any) => x.id === id || x.eventId === id);
    if (index < 0) throw notFound(`${id} is not in ${p.list}`);
    return { index };
  },
  "library.sync": (_p, { st }) => { setTimeout(() => st.bumpLibrary(["songs", "albums", "artists", "playlists"]), 300); return {}; },

  // ---- likes, saves, blocks
  "track.like": (p, { st }) => {
    const t = trackOf(st, reqStr(p, "id"));
    const liked = reqBool(p, "liked");
    const lib = st.dataset.byId.get(t.id);
    if (lib) { lib.liked = liked || undefined; if (liked) st.dataset.likedIds.add(t.id); else st.dataset.likedIds.delete(t.id); }
    t.liked = liked || undefined;
    st.bumpLibrary(["liked", "songs"]);
    return { liked };
  },
  "album.save": (p, { st }) => { const on = reqBool(p, "on"); const id = reqStr(p, "id"); on ? st.savedAlbums.add(id) : st.savedAlbums.delete(id); st.bumpLibrary(["albums"]); return { on }; },
  "artist.subscribe": (p, { st }) => { const on = reqBool(p, "on"); const id = reqStr(p, "id"); on ? st.subscribed.add(id) : st.subscribed.delete(id); st.bumpLibrary(["artists"]); return { on }; },
  "playlist.save": (p, { st }) => {
    const on = reqBool(p, "on");
    const id = reqStr(p, "id");
    if (!st.playlists.has(id)) throw notFound(`playlist ${id}`);
    on ? st.savedPlaylists.add(id) : st.savedPlaylists.delete(id);
    st.bumpLibrary(["playlists"]);
    return { on };
  },
  "track.block": (p, { st }) => { const id = reqStr(p, "id"); trackOf(st, id); reqBool(p, "on") ? st.blocked.add(id) : st.blocked.delete(id); st.bumpLibrary(["songs", "liked"]); return {}; },
  "artist.block": (p, { st }) => {
    const id = reqStr(p, "id");
    const on = reqBool(p, "on");
    for (const s of st.dataset.songs) if (s.artists.some((a) => a.id === id)) on ? st.blocked.add(s.id) : st.blocked.delete(s.id);
    st.bumpLibrary(["songs", "liked", "artists"]);
    return {};
  },

  // ---- track details
  "track.info": (p, { st }) => { const t = trackOf(st, reqStr(p, "id")); return { track: t, details: detailsFor(st, t).details }; },
  "track.sources": (p, { st }) => ({ options: detailsFor(st, trackOf(st, reqStr(p, "id"))).options }),
  /** unsupported in M1 (M3-2); the contract suite accepts that on the real target too */
  "track.setSource": (p, { st }) => { trackOf(st, reqStr(p, "id")); throw new ApiErr("unsupported", "track.setSource is not available yet"); },
  "import.files": (p) => { reqStrArr(p, "paths"); throw new ApiErr("unsupported", "import.files is not available yet"); },

  // ---- user albums
  "userAlbum.list": (_p, { st }) => ({ items: [...st.userAlbums.values()].map((u) => st.uaCard(u)) }),
  "userAlbum.create": (p, { st }) => {
    const title = reqStr(p, "title").trim();
    if (!title) throw bad("title required");
    const id = st.nextUaId();
    const ids = p.trackIds === undefined ? [] : reqStrArr(p, "trackIds");
    st.userAlbums.set(id, { id, title, pinned: false, entries: ids.filter((x) => st.registry.has(x)).map((trackId) => ({ entryId: st.nextEntryId(), trackId })) });
    touchUa(st, id);
    return { id };
  },
  "userAlbum.rename": (p, { st }) => { const u = uaOf(st, reqStr(p, "id")); const t = reqStr(p, "title").trim(); if (!t) throw bad("title"); u.title = t; touchUa(st, u.id); return {}; },
  "userAlbum.delete": (p, { st }) => { const u = uaOf(st, reqStr(p, "id")); st.userAlbums.delete(u.id); touchUa(st, u.id); return {}; },
  "userAlbum.setCover": (p, { st }) => {
    const u = uaOf(st, reqStr(p, "id"));
    if (p.path !== null && typeof p.path !== "string") throw bad("path: string|null required");
    u.cover = p.path === null ? undefined : `core:cover/${u.id.replace(":", "-")}-${(Math.abs(p.path.length * 2654435761) >>> 0).toString(16).slice(0, 8)}`;
    touchUa(st, u.id);
    return { art: { src: u.cover ?? `core:playlist_covers/${u.id.replace(":", "-")}` } };
  },
  "userAlbum.add": (p, { st }) => {
    const u = uaOf(st, reqStr(p, "id"));
    const ids = reqStrArr(p, "trackIds");
    const have = new Set(u.entries.map((e) => e.trackId));
    let added = 0, skipped = 0;
    for (const id of ids) {
      if (!st.registry.has(id) || (p.dedupe !== false && have.has(id))) { skipped++; continue; }
      u.entries.push({ entryId: st.nextEntryId(), trackId: id }); have.add(id); added++;
    }
    if (added) touchUa(st, u.id);
    return { added, skipped };
  },
  "userAlbum.remove": (p, { st }) => {
    const u = uaOf(st, reqStr(p, "id"));
    const gone = new Set(reqStrArr(p, "entryIds"));
    const before = u.entries.length;
    u.entries = u.entries.filter((e) => !gone.has(e.entryId));
    if (u.entries.length !== before) touchUa(st, u.id);
    return {};
  },
  "userAlbum.move": (p, { st }) => {
    const u = uaOf(st, reqStr(p, "id"));
    const from = reqInt(p, "from", 0), to = reqInt(p, "to", 0), expected = reqNum(p, "expectedRevision");
    if (from >= u.entries.length || to >= u.entries.length) throw bad("from/to out of range");
    if (expected !== st.lib.revision) throw new ApiErr("conflict", "stale revision", { retryable: true, details: { revision: st.lib.revision } });
    const [e] = u.entries.splice(from, 1);
    u.entries.splice(to, 0, e!);
    touchUa(st, u.id);
    return {};
  },
  "userAlbum.pin": (p, { st }) => { const u = uaOf(st, reqStr(p, "id")); u.pinned = reqBool(p, "pinned"); touchUa(st, u.id); return {}; },

  // ---- history
  "history.window": (p, { st }) => {
    const { offset, limit, list, sort, filter } = windowArgs(p);
    if (list !== "history") throw bad("list must be history");
    const items = st.listItems("history", sort, filter) as (Track & { playedAt: number; eventId: string })[];
    const timeOrdered = !filter?.text && (sort.by === "added" || sort.by === "lastPlayed");
    return {
      total: items.length, revision: st.lib.revision, offset, items: items.slice(offset, offset + limit),
      groups: timeOrdered && sort.desc ? historyGroups(items, st.historyNow()) : [],
    };
  },
  "history.remove": (p, { st }) => {
    const ids = new Set(reqStrArr(p, "eventIds"));
    const h = st.getHistory();
    st.setHistory(h.filter((e) => !ids.has(e.eventId)));
    st.bumpLibrary(["history"]);
    return {};
  },
  "history.clear": (_p, { st }) => { st.setHistory([]); st.bumpLibrary(["history"]); return {}; },
  "stats.get": (p, { st }) => {
    const span = ({ week: 7, month: 30, year: 365, all: Infinity } as Record<string, number>)[p?.period];
    if (span === undefined) throw bad("period: week|month|year|all");
    const since = st.historyNow() - span * DAY;
    const ev = st.getHistory().filter((e) => e.playedAt >= since);
    const byTrack = new Map<string, number>();
    const byArtist = new Map<string, number>();
    const byAlbum = new Map<string, number>();
    let ms = 0;
    for (const e of ev) {
      ms += e.playTimeMs;
      byTrack.set(e.songId, (byTrack.get(e.songId) ?? 0) + 1);
      const t = st.dataset.byId.get(e.songId)!;
      const a = t.artists[0]?.name;
      if (a) byArtist.set(a, (byArtist.get(a) ?? 0) + 1);
      if (t.album?.id) byAlbum.set(t.album.id, (byAlbum.get(t.album.id) ?? 0) + 1);
    }
    const top = <K>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k);
    const artists = st.dataset.artists;
    return {
      minutes: Math.round(ms / 60_000),
      topTracks: top(byTrack).map((id) => st.dataset.byId.get(id)!),
      topArtists: top(byArtist).map((n) => artists.find((a) => a.name === n)).filter((a): a is ArtistCard => !!a),
      topAlbums: top(byAlbum).map((id) => st.dataset.albums.find((a) => a.id === id)).filter((a) => !!a).map((a) => st.albumCard(a!)) as AlbumCard[],
    };
  },

  /** test hook (mock only) */
  "mock.libraryChanged": (p, { st }) => {
    st.bumpLibrary(Array.isArray(p?.lists) ? p.lists : ["songs"]);
    return { revision: st.lib.revision };
  },
};

export const topics: HandlerModule["topics"] = {
  library: ({ st }) => ({ counts: st.counts(), revision: st.lib.revision }),
};
