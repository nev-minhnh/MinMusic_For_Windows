import type { RouteName } from "../../router/routes";
import { For, Show, createMemo, createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { Art } from "../../components/Art";
import { Chip } from "../../components/Chip";
import { Icon } from "../../components/Icon";
import { SourceBadge } from "../../components/Badge";
import { Table } from "../../components/Table";
import { client } from "../../lib/core";
import { isCancelled } from "../../core/errors";
import { openItem } from "../../lib/nav";
import { navigate } from "../../router/router";
import { playerState } from "../../state/player";
import { ItemCard, Shelf } from "../Home/Shelf";
import { itemSub, itemTitle, playItem, playList } from "../Home/items";
import { t } from "../../i18n";
import "./search.css";
import type { Item, SourceId, Track } from "../../lib/types";

export type SearchSection = { type: string; title: string; items: Item[]; more?: { route: string; params: object } };
export type SearchRun = { top?: Item & { sources: SourceId[] }; sections: SearchSection[]; next: string | null };

export const SOURCES: { key: string; label: string; dot?: string }[] = [
  { key: "all", label: "w2_chip_all" },
  { key: "yt", label: "YouTube Music", dot: "#E8453C" },
  { key: "sc", label: "SoundCloud", dot: "#F26B1D" },
  { key: "zing", label: "Zing MP3", dot: "#9B51E0" },
  { key: "nct", label: "NhacCuaTui", dot: "#2F80ED" },
];
export const TYPES: { key: string; label: string }[] = [
  { key: "track", label: "w2_chip_songs" },
  { key: "album", label: "w2_chip_albums" },
  { key: "artist", label: "w2_chip_artists" },
  { key: "playlist", label: "w2_chip_playlists" },
];

/** Songs shown next to the top result before "Xem tất cả" switches the type chip to songs. */
export const PREVIEW_SONGS = 5;
export const section = (r: SearchRun | undefined, type: string) => r?.sections.find((s) => s.type === type);

/** Search results (MK 3): source and type chips, top result 5fr + songs 7fr from 1024 up, then albums, artists, playlists. */
export function Search(props: { params: Record<string, string>; active: Accessor<boolean> }) {
  const q = () => props.params.q ?? "";
  const [source, setSource] = createSignal(props.params.source ?? "all");
  const [type, setType] = createSignal(props.params.type ?? "all");
  const [res, setRes] = createSignal<SearchRun | undefined>();
  const [more, setMore] = createSignal<Item[]>([]);
  const [next, setNext] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [failed, setFailed] = createSignal(false);
  const [followed, setFollowed] = createSignal(false);
  let seq = 0;
  let paging = false;
  let sentinel!: HTMLDivElement;

  const params = (cursor?: string) => ({ q: q(), source: source(), type: type(), ...(cursor ? { cursor } : {}) });
  const load = () => {
    const mine = ++seq;
    setLoading(true);
    setFailed(false);
    setMore([]);
    client
      .call<SearchRun>("search.run", params())
      .then((r) => {
        if (mine !== seq) return;
        setRes(r);
        setNext(r.next);
        setFollowed(false);
        setLoading(false);
      })
      .catch((e) => {
        if (mine !== seq || isCancelled(e)) return;
        setFailed(true);
        setLoading(false);
      });
  };
  const pick = (s: string, ty: string) => {
    setSource(s);
    setType(ty);
    load();
  };

  const tracks = createMemo<Track[]>(() => [...((section(res(), "track")?.items ?? []) as Track[]), ...(more() as Track[])]);
  const only = () => type() !== "all";

  onMount(() => {
    load();
    // cursor paging of typed song results: a sentinel after the table, no scroll handler
    const io = new IntersectionObserver(
      (es) => {
        const cursor = next();
        if (!es.some((e) => e.isIntersecting) || !cursor || paging || type() !== "track") return;
        paging = true;
        const mine = seq;
        client
          .call<SearchRun>("search.run", params(cursor))
          .then((r) => {
            if (mine !== seq) return;
            setMore((m) => [...m, ...(section(r, "track")?.items ?? [])]);
            setNext(r.next);
          })
          .catch(() => {})
          .finally(() => (paging = false));
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(sentinel);
    onCleanup(() => io.disconnect());
  });
  onCleanup(() => seq++);

  const kindLabel = (it: Item) => t(it.t === "artist" ? "w2_srch_artist" : it.t === "album" ? "w2_srch_album" : it.t === "playlist" ? "w2_srch_playlist" : "w2_srch_song");
  const label = (k: string) => (k.startsWith("w2_") ? t(k) : k);

  const songs = (cols: ("index" | "title" | "album" | "like" | "dur" | "more")[], list: () => Track[], tid: string) => (
    <Table
      total={() => list().length}
      trackAt={(i) => list()[i]}
      label={t("w2_chip_songs")}
      testid={tid}
      header={false}
      cols={cols}
      playingId={() => playerState()?.track?.id}
      onPlay={(i) => playList(list(), i, q())}
      onOpenAlbum={(tr) => tr.album?.id && navigate("album", { id: tr.album.id })}
    />
  );

  const TopCard = (p: { it: Item & { sources: SourceId[] } }) => (
    <div class="box srch-top" data-testid="search-top" role="button" tabindex="0" onClick={() => openItem(p.it)} onKeyDown={(e) => e.key === "Enter" && openItem(p.it)}>
      <Art art={p.it.art} size={96} round={p.it.t === "artist"} />
      <div class="t28 w6 srch-top-t ell">{itemTitle(p.it)}</div>
      <div class="row srch-top-m">
        <span class="t12 i3">{`${kindLabel(p.it)} ·`}</span>
        <For each={p.it.sources}>{(s) => <SourceBadge source={s} />}</For>
        <span class="t12 i3">{`· ${t("w2_srch_n_sources", p.it.sources.length)}`}</span>
      </div>
      <Show when={p.it.t !== "artist" && itemSub(p.it)}>
        <div class="t12 i3 ell">{itemSub(p.it)}</div>
      </Show>
      <div class="row gap8 srch-top-a">
        <Show when={p.it.t === "artist"}>
          <button
            type="button"
            class="btn out sm"
            data-testid="top-follow"
            onClick={(e) => {
              e.stopPropagation();
              const on = !followed();
              setFollowed(on);
              void client.call("artist.subscribe", { id: p.it.id, on }).catch(() => setFollowed(!on));
            }}
          >
            {followed() ? t("w2_srch_following") : t("w2_srch_follow")}
          </button>
        </Show>
        <button
          type="button"
          class="fab srch-fab"
          aria-label={t("w2_play")}
          onClick={(e) => {
            e.stopPropagation();
            playItem(p.it);
          }}
        >
          <Icon n="play" s={20} />
        </button>
      </div>
    </div>
  );

  const cardsOf = (type: string) => section(res(), type)?.items ?? [];

  return (
    <div class="sc srch" data-testid="search-page" data-q={q()}>
      <div class="chips srch-chips" data-testid="search-chips">
        <For each={SOURCES}>
          {(s) => (
            <Chip on={source() === s.key} dot={s.dot} onClick={() => pick(s.key, type())}>
              {label(s.label)}
            </Chip>
          )}
        </For>
        <span class="vsep" />
        <For each={TYPES}>
          {(s) => (
            <Chip on={type() === s.key} onClick={() => pick(source(), type() === s.key ? "all" : s.key)}>
              {label(s.label)}
            </Chip>
          )}
        </For>
      </div>

      <Show when={!loading() || res()} fallback={<div class="srch-skel" data-testid="search-skeleton" aria-hidden="true">{[0, 1, 2, 3, 4].map(() => <div class="tr tr-skel"><div class="ix" /><div class="tt"><div class="art skel-art" /><div class="m"><div class="skel" style={{ width: "40%" }} /></div></div></div>)}</div>}>
        <Show when={!failed() && res() && (res()!.top || res()!.sections.length)} fallback={<div class="srch-empty t14 i3" data-testid="search-empty">{failed() ? t("w2_error_generic") : t("w2_srch_none", q())}</div>}>
          <Show when={!only()}>
            <div class="srch-grid" data-testid="search-grid">
              <Show when={res()!.top}>
                {(top) => (
                  <div class="srch-topcol">
                    <div class="t20 w6 srch-h">{t("w2_srch_top")}</div>
                    <TopCard it={top() as Item & { sources: SourceId[] }} />
                  </div>
                )}
              </Show>
              <Show when={tracks().length}>
                <div class="srch-songs" data-testid="search-songs">
                  <div class="row srch-h">
                    <div class="t20 w6 f1">{t("w2_chip_songs")}</div>
                    <button type="button" class="more" data-testid="songs-all" onClick={() => pick(source(), "track")}>
                      {t("w2_see_all")}
                    </button>
                  </div>
                  {songs(["index", "title", "like", "dur", "more"], () => tracks().slice(0, PREVIEW_SONGS), "songs-table")}
                </div>
              </Show>
            </div>
            <Show when={cardsOf("album").length}>
              <Shelf shelf={{ key: "s-album", title: t("w2_srch_albums_singles"), layout: "cards", items: cardsOf("album") }} testid="search-albums" />
            </Show>
            <Show when={cardsOf("artist").length}>
              <Shelf shelf={{ key: "s-artist", title: t("w2_chip_artists"), layout: "cards", items: cardsOf("artist") }} round testid="search-artists" />
            </Show>
            <Show when={cardsOf("playlist").length}>
              <Shelf shelf={{ key: "s-playlist", title: t("w2_chip_playlists"), layout: "cards", items: cardsOf("playlist") }} testid="search-playlists" />
            </Show>
          </Show>

          <Show when={type() === "track"}>
            <div class="srch-all">{songs(["index", "title", "album", "like", "dur", "more"], tracks, "songs-table")}</div>
          </Show>
          <Show when={only() && type() !== "track"}>
            <div class="srch-cards" classList={{ "shelf-round": type() === "artist" }} data-testid="search-cards">
              <For each={cardsOf(type())}>{(it) => <ItemCard item={it} />}</For>
            </div>
          </Show>
        </Show>
      </Show>
      <div ref={sentinel} class="srch-sentinel" data-testid="search-sentinel" aria-hidden="true" />
    </div>
  );
}

export const routes: RouteName[] = ["search"];
export default Search;
