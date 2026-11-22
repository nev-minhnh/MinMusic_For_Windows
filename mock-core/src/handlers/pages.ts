// Album, artist, playlist, podcast, related pages, plus app.openUrl and app.copyLink. Deterministic from the dataset.
import type { ArtistCard, NavTarget, Shelf, Track } from "@minmusic/protocol";
import type { HandlerModule, MockState } from "../state.ts";
import { albumPage, playlistTracks, trackItem } from "../content.ts";
import { ApiErr, bad, hash32, notFound, parseCursor, reqStr } from "../util.ts";

const PAGE = 100;

function artistCard(st: MockState, id: string): ArtistCard {
  const a = st.dataset.artists.find((x) => x.id === id);
  if (a) return a;
  const h = st.homeArtists.get(id);
  if (h) { const { t: _t, ...card } = h; return card as ArtistCard; }
  throw notFound(`artist ${id}`);
}
function artistSongs(st: MockState, name: string, min = 10): Track[] {
  let songs = st.dataset.songs.filter((s) => s.artists.some((a) => a.name === name));
  if (songs.length < min) {
    const start = hash32(name) % (st.dataset.songs.length - 150);
    songs = songs.concat(st.dataset.songs.slice(start, start + 150 - songs.length));
  }
  return songs;
}

// ---- podcast (generated: any id starting MPSP or podcast:)
const isPodcastId = (id: string) => id.startsWith("MPSP") || id.startsWith("podcast:");
function podcastEpisodes(st: MockState, id: string): Track[] {
  const start = hash32(id) % (st.dataset.songs.length - 30);
  return st.dataset.songs.slice(start, start + 30).map((t, i) => ({
    ...t, id: `${t.id}`, title: `Tập ${30 - i}: ${t.title}`, durationMs: 1_200_000 + (hash32(t.id) % 1_800_000), isVideo: false, album: { id, title: podcastTitle(id) },
  }));
}
const podcastTitle = (id: string) => `Podcast ${(hash32(id) % 900) + 100}`;

// ---- app.openUrl / app.copyLink
const YT_HOSTS = new Set(["music.youtube.com", "www.youtube.com", "youtube.com", "m.youtube.com"]);
function navFor(kind: "album" | "playlist" | "artist" | "podcast", id: string): { handled: true; nav: NavTarget } {
  return { handled: true, nav: { route: kind, params: { id } } };
}
function playVideo(st: MockState, id: string) {
  let t = st.registry.get(id);
  if (!t) {
    t = { ...st.dataset.songs[hash32(id) % st.dataset.songs.length]!, id, title: `Video ${id}` };
    st.registry.set(id, t);
  }
  st.setQueue([t], "Liên kết");
  st.emitQueue(true);
  st.startAt(0);
  st.emitState();
  return { handled: true as const };
}
export function openUrl(st: MockState, raw: string): { handled: boolean; nav?: NavTarget } {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { handled: false }; }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  if (u.protocol === "minmusic:" || u.protocol === "metrolist:") {
    // minmusic://album/<id>, metrolist://playlist/<id>, minmusic://artist/<id>, minmusic://song/<id>, minmusic://watch?v=<id>
    const kind = host || parts.shift();
    const id = host ? parts[0] : parts[0];
    if (kind === "watch" && u.searchParams.get("v")) return playVideo(st, u.searchParams.get("v")!);
    if (!id) return { handled: false };
    if (kind === "album" || kind === "playlist" || kind === "artist" || kind === "podcast") return navFor(kind, decodeURIComponent(id));
    if (kind === "song" || kind === "video") return playVideo(st, decodeURIComponent(id));
    return { handled: false };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { handled: false };

  if (host === "youtu.be") return parts[0] ? playVideo(st, parts[0]) : { handled: false };
  if (YT_HOSTS.has(host)) {
    const v = u.searchParams.get("v");
    if (parts[0] === "watch" && v) return playVideo(st, v);
    if (parts[0] === "playlist" && u.searchParams.get("list")) return navFor("playlist", u.searchParams.get("list")!);
    if (parts[0] === "channel" && parts[1]) return navFor("artist", parts[1]);
    if (parts[0] === "browse" && parts[1]) {
      const id = parts[1];
      if (id.startsWith("MPREb_")) return navFor("album", id);
      if (id.startsWith("UC")) return navFor("artist", id);
      if (id.startsWith("VL")) return navFor("playlist", id);
      if (id.startsWith("MPSP")) return navFor("podcast", id);
    }
    return { handled: false };
  }
  if (host.endsWith("zingmp3.vn")) {
    // /bai-hat/<slug>/<ID>.html, /album/<slug>/<ID>.html, /playlist/<slug>/<ID>.html
    const id = /^([A-Za-z0-9]+)\.html$/.exec(parts[2] ?? "")?.[1];
    if (!id) return { handled: false };
    if (parts[0] === "bai-hat") return playVideo(st, `zing:${id}`);
    if (parts[0] === "album" || parts[0] === "playlist") return navFor("playlist", `zing:${id}`);
    return { handled: false };
  }
  if (host.endsWith("nhaccuatui.com")) {
    // /bai-hat/<slug>.<id>.html, /playlist/<slug>.<id>.html
    const id = /\.([A-Za-z0-9]+)\.html$/.exec(parts[1] ?? "")?.[1];
    if (!id) return { handled: false };
    if (parts[0] === "bai-hat") return playVideo(st, `nct:${id}`);
    if (parts[0] === "playlist") return navFor("playlist", `nct:${id}`);
    return { handled: false };
  }
  return { handled: false };
}
function copyLink(id: string, kind: string): string {
  if (/^(sc:|zing:|nct:|local_|lp:)/.test(id)) throw new ApiErr("unsupported", "link sharing is only available for YouTube ids");
  switch (kind) {
    case "song": case "track": case "video": return `https://music.youtube.com/watch?v=${id}`;
    case "album": return `https://music.youtube.com/browse/${id}`;
    case "artist": return `https://music.youtube.com/channel/${id}`;
    case "playlist": return `https://music.youtube.com/playlist?list=${id.replace(/^VL/, "")}`;
    case "podcast": return `https://music.youtube.com/browse/${id}`;
    default: throw bad(`unknown kind ${kind}`);
  }
}

export const handlers: HandlerModule["handlers"] = {
  "album.get": (p, { st }) => albumPage(st, reqStr(p, "id")),

  "artist.get": (p, { st }) => {
    const card = artistCard(st, reqStr(p, "id"));
    const songs = artistSongs(st, card.name);
    const ownAlbums = st.dataset.albums.filter((a) => a.artists[0]?.name === card.name);
    const pick = (kinds: string[]) => {
      let l = ownAlbums.filter((a) => kinds.includes(a.kind));
      if (l.length < 4) l = l.concat(st.dataset.albums.filter((a) => kinds.includes(a.kind) && !l.includes(a)).slice(hash32(card.name) % 10, (hash32(card.name) % 10) + 6 - l.length));
      return l.slice(0, 8).map((a) => ({ t: "album" as const, ...st.albumCard(a) }));
    };
    const shelves: Shelf[] = [
      { key: "topSongs", title: "Bài hát hàng đầu", layout: "rows", items: songs.slice(0, 10).map(trackItem), more: { route: "artistAbout", params: { id: card.id } } },
      { key: "albums", title: "Album", layout: "cards", items: pick(["album", "ep"]) },
      { key: "singles", title: "Đĩa đơn", layout: "cards", items: pick(["single"]) },
      { key: "videos", title: "Video", layout: "rows", items: songs.slice(10, 18).map((t) => trackItem({ ...t, isVideo: true })) },
      { key: "related", title: "Nghệ sĩ tương tự", layout: "cards", items: st.dataset.artists.filter((a) => a.id !== card.id).slice(hash32(card.id) % 30, (hash32(card.id) % 30) + 8).map((a) => ({ t: "artist" as const, ...a })) },
    ];
    return {
      artist: {
        ...card, banner: card.art, subscribers: `${(hash32(card.id) % 90) / 10 + 0.5}Tr người đăng ký`, monthly: `${(hash32(card.id) % 40) / 10 + 1}Tr lượt nghe hằng tháng`,
        description: `Nghệ sĩ giả của mock core: ${card.name}.`, subscribed: st.subscribed.has(card.id),
      },
      shelves,
      sources: [...new Set(songs.map((s) => s.source))].slice(0, 4),
    };
  },
  "artist.about": (p, { st }) => {
    const card = artistCard(st, reqStr(p, "id"));
    const h = hash32(card.id);
    return {
      bio: `${card.name} là một nghệ sĩ được tạo cho mock core. Tiểu sử dài hơn một dòng để kiểm tra bố cục: ra mắt năm ${2000 + (h % 20)}, phát hành nhiều album và đĩa đơn.`,
      stats: { monthlyListeners: 100_000 + (h % 5_000_000), songs: artistSongs(st, card.name).length, albums: st.dataset.albums.filter((a) => a.artists[0]?.name === card.name).length },
      lastfm: { listeners: 50_000 + (h % 900_000), playcount: 1_000_000 + (h % 90_000_000), tags: ["pop", "vietnamese", "ballad"] },
    };
  },
  "artist.tracks": (p, { st }) => {
    const card = artistCard(st, reqStr(p, "id"));
    const all = artistSongs(st, card.name, 120);
    const at = parseCursor(p.cursor, "artist");
    const items = all.slice(at, at + 50);
    return { items, next: at + 50 < all.length ? `artist:${at + 50}` : null };
  },

  "playlist.get": (p, { st }) => {
    const id = reqStr(p, "id");
    const at = parseCursor(p.cursor, "pl");
    const ua = id.startsWith("lp:") ? st.userAlbums.get(id) : undefined;
    if (id.startsWith("lp:") && !ua) throw notFound(`playlist ${id}`);
    const pc = ua ? st.uaCard(ua) : st.playlists.get(id);
    if (!pc) throw notFound(`playlist ${id}`);
    const all = ua ? st.userAlbumTracks(id) : playlistTracks(st, id);
    const tracks = all.slice(at, at + PAGE);
    const { pinned: _p, revision: _r, ...card } = pc as any;
    return {
      playlist: { ...card, description: ua ? undefined : "Danh sách phát giả của mock core.", durationMs: all.reduce((s, t) => s + (t.durationMs ?? 0), 0), editable: !!ua, revision: st.lib.revision },
      tracks,
      next: at + PAGE < all.length ? `pl:${at + PAGE}` : null,
    };
  },

  "podcast.get": (p, { st }) => {
    const id = reqStr(p, "id");
    if (!isPodcastId(id)) throw notFound(`podcast ${id}`);
    const eps = podcastEpisodes(st, id);
    const host = st.dataset.artists[hash32(id) % st.dataset.artists.length]!;
    return {
      album: {
        id, title: podcastTitle(id), artists: [{ id: host.id, name: host.name }], year: 2024, art: eps[0]!.art, source: "yt" as const, kind: "album" as const,
        description: "Podcast giả của mock core.", durationMs: eps.reduce((s, t) => s + (t.durationMs ?? 0), 0), trackCount: eps.length, label: "Mock Podcasts", saved: st.savedAlbums.has(id),
      },
      tracks: eps.slice(0, 10), otherVersions: [],
    };
  },
  "podcast.episodes": (p, { st }) => {
    const id = reqStr(p, "id");
    if (!isPodcastId(id)) throw notFound(`podcast ${id}`);
    const eps = podcastEpisodes(st, id);
    const at = parseCursor(p.cursor, "ep");
    return { items: eps.slice(at, at + 10), next: at + 10 < eps.length ? `ep:${at + 10}` : null };
  },

  "related.get": (p, { st }) => {
    const seed = st.registry.get(reqStr(p, "trackId"));
    if (!seed) throw notFound(`track ${p.trackId}`);
    return {
      shelves: [
        { key: "related", title: "Có thể bạn thích", layout: "rows", items: st.relatedTracks(seed, 25).map(trackItem) },
        { key: "relatedAlbums", title: "Album liên quan", layout: "cards", items: st.dataset.albums.slice(hash32(seed.id) % 30, (hash32(seed.id) % 30) + 6).map((a) => ({ t: "album" as const, ...st.albumCard(a) })) },
      ],
    };
  },

  "app.openUrl": (p, { st }) => openUrl(st, reqStr(p, "url")),
  "app.copyLink": (p) => ({ url: copyLink(reqStr(p, "id"), reqStr(p, "kind")) }),
};
