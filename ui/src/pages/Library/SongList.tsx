import { Show, createSignal, onCleanup, onMount, type Accessor, type JSX } from "solid-js";
import { Icon } from "../../components/Icon";
import { IconButton } from "../../components/IconButton";
import { Table, type TableApi } from "../../components/Table";
import { createWindowStore } from "../../state/library";
import { openMenu } from "../../components/Menu";
import { player, playerState } from "../../state/player";
import { navigate } from "../../router/router";
import { t, plural } from "../../i18n";
import { debounce, onPageEvent } from "./util";
import type { FilterSpec, LocalList, SortSpec, Track } from "../../lib/types";
import type { MenuItem } from "../../menus/types";

const EMPTY = {
  w2_lib_empty_songs: () => t("w2_lib_empty_songs"),
  w2_lib_empty_liked: () => t("w2_lib_empty_liked"),
  w2_lib_empty_downloads: () => t("w2_lib_empty_downloads"),
};

export const DEFAULT_SORT: SortSpec = { by: "added", desc: true };

/** Sort entries of the sort menu (Library toolbar): by + the direction a fresh pick starts with. */
export const SORT_CHOICES: { by: SortSpec["by"]; desc: boolean; label: () => string }[] = [
  { by: "added", desc: true, label: () => t("w2_lib_sort_added") },
  { by: "title", desc: false, label: () => t("w2_lib_sort_title") },
  { by: "artist", desc: false, label: () => t("w2_lib_sort_artist") },
  { by: "album", desc: false, label: () => t("w2_lib_sort_album") },
  { by: "duration", desc: false, label: () => t("w2_lib_sort_duration") },
];

export type ListApi = { openSortMenu: (at: { x: number; y: number }) => void; setText: (s: string) => void };

/** The filter field of a list toolbar: 150 ms debounce into `onText`, Esc clears it. */
export function FilterField(props: { value: Accessor<string>; onInput: (s: string) => void; placeholder: string; label: string; testid?: string }) {
  return (
    <label class="lb-find">
      <Icon n="search" s={16} />
      <input
        type="search"
        class="lb-find-in"
        value={props.value()}
        placeholder={props.placeholder}
        aria-label={props.label}
        data-testid={props.testid ?? "lib-filter"}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && props.value()) {
            e.preventDefault();
            e.stopPropagation();
            props.onInput("");
          }
        }}
      />
    </label>
  );
}

/**
 * A song list over one `library.window` list: toolbar (text filter, scroll to the playing song), optional big header (count, Phát tất cả,
 * Trộn bài: Liked and Downloads), and the shared Table with header-click sorting. Rows come from `createWindowStore` in chunks of 100.
 */
export function SongList(props: {
  list: LocalList;
  /** fixed part of the FilterSpec (e.g. `{downloaded:true}`) */
  base?: FilterSpec;
  label: string;
  testid?: string;
  sort0?: SortSpec;
  /** big header (Liked, Downloads) with the page title */
  title?: string;
  emptyKey: "w2_lib_empty_songs" | "w2_lib_empty_liked" | "w2_lib_empty_downloads";
  /** a place for the page to put buttons next to the filter field (Library: sort) */
  tools?: JSX.Element;
  onApi?: (a: ListApi) => void;
  active?: Accessor<boolean>;
}) {
  const store = createWindowStore<Track>(props.list, props.sort0 ?? DEFAULT_SORT, props.base);
  const [text, setText] = createSignal("");
  const [settled, setSettled] = createSignal(false);
  let tapi: TableApi | undefined;
  let root!: HTMLDivElement;

  const applyFilter = debounce((v: string) => {
    const s = v.trim();
    tapi?.sel.clear();
    store.setFilter({ ...props.base, ...(s ? { text: s } : {}) });
  }, 150);
  const onText = (v: string) => {
    setText(v);
    applyFilter(v);
  };
  onCleanup(() => applyFilter.cancel());

  const ctx = () => ({ kind: "library" as const, list: props.list, sort: store.sort(), filter: store.filter() });
  const playAt = (i: number) => {
    const tr = store.track(i);
    if (tr) void player.play(ctx(), { startId: tr.id });
  };
  const openAlbum = (tr: Track) => tr.album?.id && navigate("album", { id: tr.album.id });

  const locate = async () => {
    const id = playerState()?.track?.id;
    if (!id) return;
    const i = await store.indexOf(id);
    if (i < 0) return;
    tapi?.scrollToIndex(Math.max(0, i - 1));
    tapi?.sel.selectOnly(String(i));
  };
  const openSortMenu = (at: { x: number; y: number }) => {
    const cur = store.sort();
    const items: MenuItem[] = SORT_CHOICES.map((c) => ({
      id: `sort-${c.by}`,
      label: c.label(),
      checked: cur.by === c.by,
      hint: cur.by === c.by ? (cur.desc ? "↓" : "↑") : undefined,
      run: () => store.setSort(cur.by === c.by ? { by: c.by, desc: !cur.desc } : { by: c.by, desc: c.desc }),
    }));
    openMenu(items, at);
  };
  props.onApi?.({ openSortMenu, setText: onText });

  onMount(() => {
    const id = setTimeout(() => setSettled(true), 500);
    onCleanup(() => clearTimeout(id));
    onPageEvent(root, "mm-refresh", () => store.setSort(store.sort()));
  });

  return (
    <div ref={root} class="lb-list" data-testid={`${props.testid ?? "songs"}-list-root`}>
      <Show when={props.title}>
        <div class="lb-hero">
          <div class="f1" style={{ "min-width": "0" }}>
            <div class="t28 w6">{props.title}</div>
            <div class="i2" style={{ "margin-top": "4px" }} data-testid="lib-count">
              {plural("w2_n_songs", store.total())}
            </div>
          </div>
          <button type="button" class="btn pri" data-testid="lib-play-all" onClick={() => void player.play(ctx())}>
            <Icon n="play" s={20} />
            {t("w2_lib_play_all")}
          </button>
          <button type="button" class="btn ton" data-testid="lib-shuffle" onClick={() => void player.play(ctx(), { shuffle: true })}>
            <Icon n="shuffle" s={20} />
            {t("shuffle")}
          </button>
        </div>
      </Show>
      <div class="lb-tools">
        <FilterField value={text} onInput={onText} placeholder={t("w2_lib_filter_ph")} label={t("w2_lib_filter_ph")} />
        <div class="f1" />
        <Show when={!props.title}>
          <span class="t12 i3 num" data-testid="lib-count">
            {plural("w2_n_songs", store.total())}
          </span>
        </Show>
        <IconButton icon="lib_locate" label={t("w2_lib_locate")} testid="lib-locate" onClick={() => void locate()} />
        {props.tools}
      </div>
      <Table
        total={store.total}
        trackAt={store.track}
        ensure={store.ensure}
        label={props.label}
        testid={props.testid ?? "songs-table"}
        sort={store.sort()}
        onSort={(s) => store.setSort(s)}
        playingId={() => playerState()?.track?.id}
        onPlay={playAt}
        onOpenAlbum={openAlbum}
        api={(a) => (tapi = a)}
      />
      <Show when={store.total() === 0 && settled()}>
        <div class="empty-state" data-testid="lib-empty">
          <Icon n="music_note" s={32} />
          <div>{text().trim() ? t("w2_lib_empty_filter") : EMPTY[props.emptyKey]()}</div>
        </div>
      </Show>
    </div>
  );
}
