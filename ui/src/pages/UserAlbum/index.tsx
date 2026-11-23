import type { RouteName } from "../../router/routes";
import { For, Show, createMemo, createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { Art } from "../../components/Art";
import { Icon } from "../../components/Icon";
import { IconButton } from "../../components/IconButton";
import { SourceBadge } from "../../components/Badge";
import { Table, type TableApi } from "../../components/Table";
import { createWindowStore } from "../../state/library";
import { player, playerState } from "../../state/player";
import { userAlbums, userAlbumsLoaded } from "../../state/userAlbums";
import { changeCover, deleteAlbum, renameAlbum } from "../../menus/userAlbum";
import { client } from "../../lib/core";
import { hClass } from "../../lib/layout";
import { back, navigate } from "../../router/router";
import { toast } from "../../toast";
import { t, plural } from "../../i18n";
import { keepScroll, onPageEvent } from "../Library/util";
import { attachReorder, createRevision, errorCode } from "./reorder";
import type { SourceId, Track } from "../../lib/types";
import "../Library/library.css";

const SORT = { by: "custom", desc: false } as const;
const durationText = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? t("w2_dur_hm", Math.floor(m / 60), m % 60) : t("w2_dur_m", m);
};

/**
 * Album of mine (MK "Album của tôi"): header (art 168 / 232 by height class), a sticky 56 bar (IntersectionObserver sentinel, no scroll
 * handler) and the table of `library.window userAlbum:<id>` in the custom order. Drag reorder -> userAlbum.move (conflict: refetch and
 * toast), Del -> userAlbum.remove, F2 renames, F5 refreshes.
 */
export function UserAlbum(props: { params: Record<string, string>; active: Accessor<boolean> }) {
  const id = props.params.id;
  const list = `userAlbum:${id}` as const;
  const store = createWindowStore<Track>(list, SORT);
  const rev = createRevision(list);
  const album = () => userAlbums.get(id);
  const [stuck, setStuck] = createSignal(false);
  const [settled, setSettled] = createSignal(false);
  let root!: HTMLDivElement;
  let sentinel!: HTMLDivElement;
  let tableWrap!: HTMLDivElement;
  let tapi: TableApi | undefined;

  /** duration, source mix and downloaded count: only when the whole album is in memory (<= 300 rows) */
  const stats = createMemo(() => {
    const n = store.total();
    if (!n || n > 300) return null;
    let ms = 0;
    let dl = 0;
    const by = new Map<SourceId, number>();
    for (let i = 0; i < n; i++) {
      const x = store.track(i);
      if (!x) return null;
      ms += x.durationMs ?? 0;
      if (x.download === "downloaded") dl++;
      by.set(x.source, (by.get(x.source) ?? 0) + 1);
    }
    return { ms, dl, by: [...by.entries()] };
  });

  const ctx = (shuffle = false, startId?: string) => void player.play({ kind: "userAlbum", id, title: album()?.title }, { shuffle, startId });
  const playAt = (i: number) => {
    const tr = store.track(i);
    if (tr) ctx(false, tr.id);
  };
  const reload = () => {
    void userAlbums.refresh();
    store.setSort(store.sort());
  };

  const rename = () => {
    const a = album();
    if (a) void renameAlbum(a);
  };
  const removeSelected = async () => {
    const tracks = tapi?.selectedTracks() ?? [];
    const entryIds = tracks.map((x) => x.setVideoId ?? "").filter(Boolean);
    if (!entryIds.length) return;
    try {
      await client.call("userAlbum.remove", { id, entryIds });
      tapi?.sel.clear();
      toast({ text: plural("w2_ua_removed_n", entryIds.length) });
    } catch {
      toast({ i18n: "w2_error_generic", level: "error" });
    }
  };
  const onReorder = async (from: number, to: number) => {
    try {
      await client.call("userAlbum.move", { id, from, to, expectedRevision: await rev.get() });
      await rev.sync();
    } catch (e) {
      await rev.sync();
      if (errorCode(e) === "conflict") {
        store.setSort(store.sort());
        toast({ i18n: "w2_ua_conflict" });
      } else toast({ i18n: "w2_error_generic", level: "error" });
    }
  };
  const del = async () => {
    const a = album();
    if (a && (await deleteAlbum(a))) back();
  };

  onMount(() => {
    if (!userAlbumsLoaded()) void userAlbums.refresh();
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { threshold: 0 });
    io.observe(sentinel);
    const tid = setTimeout(() => setSettled(true), 600);
    const tbl = tableWrap.querySelector<HTMLElement>(".tbl2");
    const off = tbl ? attachReorder(tbl, root.closest<HTMLElement>(".pg") ?? root, { list, total: store.total, onReorder: (f, to) => void onReorder(f, to) }) : () => {};
    keepScroll(root, props.active);
    onPageEvent(root, "mm-delete", () => void removeSelected());
    onPageEvent(root, "mm-rename", rename);
    onPageEvent(root, "mm-refresh", reload);
    onCleanup(() => {
      io.disconnect();
      clearTimeout(tid);
      off();
    });
  });

  const art = () => album()?.art;
  const artSize = () => (hClass() === "short" ? 168 : 232);
  const missing = () => settled() && userAlbumsLoaded() && !album() && store.total() === 0;

  return (
    <div ref={root} class="sc album ua" data-testid="user-album" data-album-id={id}>
      <div class="al-sentinel" ref={sentinel} />
      <div class="al-sticky" aria-hidden={!stuck()}>
        <div class="al-bar" classList={{ on: stuck() }} data-testid="ua-sticky">
          <Show when={album()}>
            {(a) => (
              <>
                <Art art={a().art} size={40} />
                <div class="w6 f1 ell">{a().title}</div>
                <button type="button" class="btn pri sm" tabindex={stuck() ? 0 : -1} onClick={() => ctx()}>
                  <Icon n="play" s={16} />
                  {t("w2_play")}
                </button>
              </>
            )}
          </Show>
        </div>
      </div>
      <Show
        when={!missing()}
        fallback={
          <div class="empty-state ua-missing" data-testid="ua-missing">
            <Icon n="album" s={32} />
            <div>{t("w2_ua_missing")}</div>
            <button type="button" class="btn ton sm" onClick={() => navigate("library")}>
              {t("library")}
            </button>
          </div>
        }
      >
        <div class="ua-head">
          <Show when={album()} fallback={<div class="art skel-art al-art ua-art" style={{ width: `${artSize()}px`, height: `${artSize()}px` }} />}>
            <Art art={art()} size={artSize()} class="al-art ua-art" />
          </Show>
          <div class="f1" style={{ "min-width": "0" }}>
            <div class="ovl">{t("w2_my_albums_caps")}</div>
            <div class="t28 w6" style={{ "margin-top": "4px" }} data-testid="ua-title">
              {album()?.title ?? " "}
            </div>
            <div class="i2" style={{ "margin-top": "4px" }} data-testid="ua-sub">
              {t("w2_created_by_you")} · <span class="num">{store.total()}</span> {t("w2_songs_unit")}
              <Show when={stats()}>{(s) => <> · {durationText(s().ms)}</>}</Show>
            </div>
            <Show when={stats()}>
              {(s) => (
                <div class="row" style={{ gap: "6px", "margin-top": "8px" }}>
                  <For each={s().by}>{([src, n]) => <SourceBadge source={src} count={n} />}</For>
                  <Show when={s().dl > 0}>
                    <span class="t12 i3">{t("w2_downloaded_n", s().dl)}</span>
                  </Show>
                </div>
              )}
            </Show>
            <div class="ua-actions">
              <button type="button" class="btn pri" data-testid="ua-play" onClick={() => ctx()}>
                <Icon n="play" s={20} />
                {t("w2_play")}
              </button>
              <button type="button" class="btn ton" data-testid="ua-shuffle" onClick={() => ctx(true)}>
                <Icon n="shuffle" s={20} />
                {t("shuffle")}
              </button>
              <IconButton icon="edit" label={`${t("w2_rename_album")} (F2)`} tonal size={40} testid="ua-rename" onClick={rename} />
              <IconButton icon="image" label={t("w2_change_cover")} tonal size={40} testid="ua-cover" onClick={() => album() && void changeCover(album()!)} />
              <IconButton
                icon="push_pin"
                label={album()?.pinned ? t("w2_unpin_sidebar") : t("w2_pin_sidebar")}
                tonal
                size={40}
                active={!!album()?.pinned}
                testid="ua-pin"
                onClick={() => void userAlbums.pin(id, !album()?.pinned)}
              />
              <IconButton icon="delete" label={t("w2_ua_delete_album")} tonal size={40} testid="ua-delete" onClick={() => void del()} />
            </div>
          </div>
        </div>
        <div ref={tableWrap} class="ua-tbl">
          <Table
            total={store.total}
            trackAt={store.track}
            ensure={store.ensure}
            label={album()?.title ?? t("w2_ua_album")}
            testid="ua-table"
            sort={store.sort()}
            userAlbumId={id}
            playingId={() => playerState()?.track?.id}
            onPlay={playAt}
            onOpenAlbum={(tr) => tr.album?.id && navigate("album", { id: tr.album.id })}
            api={(a) => (tapi = a)}
          />
        </div>
        <Show when={store.total() === 0 && settled()}>
          <div class="empty-state" data-testid="ua-empty">
            <Icon n="music_note" s={32} />
            <div>{t("w2_ua_empty")}</div>
          </div>
        </Show>
      </Show>
    </div>
  );
}

export const routes: RouteName[] = ["userAlbum"];
export default UserAlbum;
