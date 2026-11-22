// Content builders shared by several handler areas (pages, queue, browse, search).
import type { Item, PlayContext, Shelf, Track } from "@minmusic/protocol";
import type { MockState } from "./state.ts";
import { bad, hash32, isObj, notFound } from "./util.ts";

export const trackItem = (t: Track) => ({ t: "track" as const, ...t });

export function albumPage(st: MockState, id: string) {
  const { dataset, albumFixture, homeAlbums, registry } = st;
  if (id === albumFixture.album.id) return { ...albumFixture, album: { ...albumFixture.album, saved: st.savedAlbums.has(id) }, moreBy: moreBy(st, albumFixture.album.artists[0]?.name) };
  const a = dataset.albums.find((x) => x.id === id);
  if (a) {
    const tracks = a.trackIds.map((t) => dataset.byId.get(t)!);
    const { trackIds: _t, label, ...card } = a;
    const others = dataset.albums.filter((x) => x.id !== id && x.artists[0]?.name === a.artists[0]?.name).slice(0, 3).map(st.albumCard);
    return {
      album: { ...card, description: `Album giả của ${a.artists[0]!.name}.`, durationMs: tracks.reduce((s, t) => s + (t.durationMs ?? 0), 0), trackCount: tracks.length, year: a.year ?? 2020, label, saved: st.savedAlbums.has(id) },
      tracks, otherVersions: others, moreBy: moreBy(st, a.artists[0]?.name, id),
    };
  }
  const h = homeAlbums.get(id);
  if (h) {
    const { t: _t, ...card } = h;
    const start = hash32(id) % (dataset.songs.length - 12);
    const tracks = dataset.songs.slice(start, start + 10).map((t) => ({ ...t, art: card.art, album: { id, title: card.title } }));
    for (const t of tracks) registry.set(t.id, t);
    const ov = dataset.albums.slice(hash32(id) % 30, (hash32(id) % 30) + 2).map(st.albumCard);
    return {
      album: { ...card, description: "Nội dung giả cho mock core.", durationMs: tracks.reduce((s, t) => s + (t.durationMs ?? 0), 0), trackCount: tracks.length, year: card.year ?? 2021, label: "Mock Records", saved: st.savedAlbums.has(id) },
      tracks, otherVersions: ov, moreBy: moreBy(st, card.artists?.[0]?.name, id),
    };
  }
  throw notFound(`album ${id}`);
}

/** "More by <artist>" shelf of album cards */
function moreBy(st: MockState, artist: string | undefined, exceptId?: string): Shelf | undefined {
  if (!artist) return undefined;
  let albums = st.dataset.albums.filter((a) => a.artists[0]?.name === artist && a.id !== exceptId);
  if (albums.length < 3) albums = albums.concat(st.dataset.albums.filter((a) => a.id !== exceptId).slice(hash32(artist) % 30, (hash32(artist) % 30) + 4 - albums.length));
  return { key: "moreBy", title: `Thêm từ ${artist}`, layout: "cards", items: albums.slice(0, 6).map((a) => ({ t: "album" as const, ...st.albumCard(a) })) };
}

/** Tracks of a remote playlist: 300, deterministic from the id. */
export function playlistTracks(st: MockState, id: string): Track[] {
  const start = hash32(id) % (st.dataset.songs.length - 300);
  return st.dataset.songs.slice(start, start + 300);
}

export function resolveContext(st: MockState, ctx: PlayContext): { tracks: Track[]; title: string } {
  if (!isObj(ctx) || typeof (ctx as any).kind !== "string") throw bad("context.kind required");
  const { dataset, registry } = st;
  switch (ctx.kind) {
    case "tracks": {
      if (!Array.isArray(ctx.ids)) throw bad("context.ids required");
      const tracks = ctx.ids.map((id) => registry.get(id) ?? (() => { throw notFound(`track ${id}`); })());
      return { tracks, title: ctx.title ?? "Hàng đợi" };
    }
    case "album": {
      const a = albumPage(st, ctx.id ?? "");
      return { tracks: a.tracks, title: a.album.title };
    }
    case "playlist": {
      const pc = st.playlists.get(ctx.id ?? "");
      if (!pc) throw notFound(`playlist ${ctx.id}`);
      return { tracks: playlistTracks(st, pc.id).slice(0, 100), title: pc.title };
    }
    case "userAlbum": {
      const u = st.userAlbums.get(ctx.id ?? "");
      if (!u) throw notFound(`userAlbum ${ctx.id}`);
      return { tracks: st.userAlbumTracks(u.id), title: u.title };
    }
    case "artist": {
      const name = dataset.artists.find((a) => a.id === ctx.id)?.name ?? (st.homeArtists.get(ctx.id ?? "") as any)?.name;
      if (!name) throw notFound(`artist ${ctx.id}`);
      let tracks = dataset.songs.filter((s) => s.artists.some((a) => a.name === name)).slice(0, 50);
      if (tracks.length < 5) tracks = dataset.songs.slice(hash32(name) % 4000, (hash32(name) % 4000) + 20);
      return { tracks, title: name };
    }
    case "library": {
      const items = st.listItems(ctx.list ?? "songs", ctx.sort ?? { by: "added", desc: true }, ctx.filter);
      return { tracks: items.filter((x) => "source" in x && "artists" in x && !("kind" in x)) as Track[], title: "Thư viện" };
    }
    case "radio": {
      const seed = ctx.id ? registry.get(ctx.id) : undefined;
      if (ctx.id && !seed) throw notFound(`track ${ctx.id}`);
      return { tracks: seed ? [seed, ...st.relatedTracks(seed, 24)] : dataset.songs.slice(0, 25), title: "Radio" };
    }
    default:
      throw bad(`unknown context kind ${String((ctx as any).kind)}`);
  }
}

export type { Item };
