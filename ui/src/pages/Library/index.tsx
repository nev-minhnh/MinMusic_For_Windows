import type { RouteName } from "../../router/routes";
import { For, Match, Show, Switch, createMemo, createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { Chip } from "../../components/Chip";
import { Card } from "../../components/Card";
import { Icon } from "../../components/Icon";
import { IconButton } from "../../components/IconButton";
import { openMenu } from "../../components/Menu";
import { delegate } from "../../lib/delegate";
import { dropTarget } from "../../lib/dnd";
import { navigate } from "../../router/router";
import { player } from "../../state/player";
import { addDropped, userAlbums } from "../../state/userAlbums";
import { createAlbumWith } from "../../menus/song";
import { userAlbumMenu } from "../../menus/userAlbum";
import { t, plural } from "../../i18n";
import { SongList, SORT_CHOICES, FilterField, type ListApi } from "./SongList";
import { CardGrid, type CardList } from "./CardGrid";
import { DownloadsBox } from "../../components/downloads/DownloadsBox";
import { debounce, onPageEvent } from "./util";
import type { SortSpec } from "../../lib/types";
import "./library.css";

export const FILTERS = ["songs", "liked", "downloaded", "albums", "artists", "playlists"] as const;
export type LibFilter = (typeof FILTERS)[number];
export const isLibFilter = (s: string | undefined): s is LibFilter => !!s && (FILTERS as readonly string[]).includes(s);
const isCardList = (f: LibFilter): f is CardList => f === "albums" || f === "artists" || f === "playlists";

const chipLabel = (f: LibFilter) =>
  f === "songs" ? t("w2_chip_songs") : f === "liked" ? t("w2_lib_chip_liked") : f === "downloaded" ? t("w2_downloaded") : f === "albums" ? t("w2_chip_albums") : f === "artists" ? t("w2_chip_artists") : t("w2_chip_playlists");

/**
 * Library (MK 4): title, filter chips (Bài hát, Đã thích, Đã tải, Album, Nghệ sĩ, Playlist), the "Album của tôi" shelf with the dashed
 * "Tạo album mới" tile, the downloads summary box and the list of the chosen filter: a song Table (5,000 rows on a VirtualList) or a card grid.
 * Route params: `filter?` picks the chip.
 */
export function Library(props: { params: Record<string, string>; active: Accessor<boolean> }) {
  const [filter, setFilter] = createSignal<LibFilter>(isLibFilter(props.params.filter) ? props.params.filter : "songs");
  const [view, setView] = createSignal<"grid" | "list">("grid");
  const [text, setText] = createSignal("");
  const [applied, setApplied] = createSignal("");
  const [cardSort, setCardSort] = createSignal<SortSpec>({ by: "added", desc: true });
  const [total, setTotal] = createSignal(0);
  const [allAlbums, setAllAlbums] = createSignal(false);
  let listApi: ListApi | undefined;
  let root!: HTMLDivElement;

  const apply = debounce((v: string) => setApplied(v), 150);
  onCleanup(() => apply.cancel());
  const onText = (v: string) => {
    setText(v);
    apply(v);
  };
  const pick = (f: LibFilter) => {
    if (f === filter()) return;
    setText("");
    setApplied("");
    apply.cancel();
    setTotal(0);
    setFilter(f);
  };

  onMount(() => {
    void userAlbums.refresh();
    onPageEvent(root, "mm-refresh", () => void userAlbums.refresh());
  });

  const albums = () => userAlbums.all();
  const shown = createMemo(() => (allAlbums() ? albums() : albums().slice(0, 5)));
  const sortMenu = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const at = { x: r.right, y: r.bottom + 4 };
    if (!isCardList(filter())) return listApi?.openSortMenu(at);
    const cur = cardSort();
    openMenu(
      SORT_CHOICES.filter((c) => c.by === "added" || c.by === "title").map((c) => ({
        id: `sort-${c.by}`,
        label: c.label(),
        checked: cur.by === c.by,
        run: () => setCardSort(cur.by === c.by ? { by: c.by, desc: !cur.desc } : { by: c.by, desc: c.desc }),
      })),
      at
    );
  };
  const createAlbum = () => void createAlbumWith();

  return (
    <div ref={root} class="sc library" data-testid="library">
      <div class="row gap8 lib-head">
        <div class="t28 w6 f1">{t("library")}</div>
        <button type="button" class="btn ton sm" data-testid="lib-create-album" onClick={createAlbum}>
          <Icon n="plus" s={16} />
          {t("w2_create_album")}
        </button>
        <IconButton icon="sort" label={t("w2_sort")} testid="lib-sort" onClick={sortMenu} />
        <Show when={isCardList(filter())}>
          <div class="seg alt2 s1" role="tablist" aria-label={t("w2_view_grid")}>
            <button type="button" role="tab" aria-selected={view() === "grid"} classList={{ on: view() === "grid" }} style={{ padding: "0 10px" }} aria-label={t("w2_view_grid")} data-testid="lib-view-grid" onClick={() => setView("grid")}>
              <Icon n="grid" s={16} />
            </button>
            <button type="button" role="tab" aria-selected={view() === "list"} classList={{ on: view() === "list" }} style={{ padding: "0 10px" }} aria-label={t("w2_view_list")} data-testid="lib-view-list" onClick={() => setView("list")}>
              <Icon n="listv" s={16} />
            </button>
          </div>
        </Show>
      </div>
      <div class="chips" role="tablist" aria-label={t("library")} style={{ "margin-top": "16px" }} data-testid="lib-chips">
        <For each={FILTERS}>
          {(f) => (
            <button type="button" role="tab" class="chip" classList={{ on: filter() === f }} aria-selected={filter() === f} data-testid={`lib-chip-${f}`} onClick={() => pick(f)}>
              {chipLabel(f)}
            </button>
          )}
        </For>
      </div>

      <Show when={filter() === "songs"}>
        <div class="sh">
          <h3>{t("w2_my_albums")}</h3>
          <Show when={albums().length > 5 || allAlbums()}>
            <button type="button" class="more" data-testid="lib-albums-all" onClick={() => setAllAlbums((v) => !v)}>
              {allAlbums() ? t("w2_lib_show_less") : t("w2_view_all_n", albums().length)}
            </button>
          </Show>
        </div>
        <div ref={(el) => onCleanup(delegate(el))} class="shelf lib-shelf" classList={{ "lib-shelf-all": allAlbums() }} data-testid="lib-albums">
          <div
            class="lb-cell"
            ref={(el) => onCleanup(dropTarget(el, (p) => void createAlbumWith(p.ids)))}
          >
            <Card dashed title={t("w2_new_album")} subtitle={t("w2_drag_here")} onOpen={createAlbum} playLabel={t("w2_play")}>
              <Icon n="plus" s={32} />
            </Card>
          </div>
          <For each={shown()}>
            {(a) => (
              <div class="lb-cell" ref={(el) => onCleanup(dropTarget(el, (p) => void addDropped(a.id, p.ids)))}>
                <Card
                  title={a.title}
                  subtitle={a.subtitle}
                  art={a.art}
                  dataKey={`ua:${a.id}`}
                  onOpen={() => navigate("userAlbum", { id: a.id })}
                  onPlay={() => void player.play({ kind: "userAlbum", id: a.id, title: a.title })}
                  playLabel={t("w2_play")}
                  onContext={(e) => openMenu(userAlbumMenu(a), { x: e.clientX, y: e.clientY })}
                />
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={filter() === "songs" || filter() === "downloaded"}>
        <DownloadsBox />
      </Show>

      <Show when={filter() === "songs"}>
        <div class="sh" style={{ "margin-bottom": "4px" }}>
          <h3>{t("w2_chip_songs")}</h3>
        </div>
      </Show>

      <div class="lb-body" data-filter={filter()}>
        <Switch>
          <Match when={filter() === "songs"}>
            <SongList list="songs" label={t("w2_chip_songs")} emptyKey="w2_lib_empty_songs" onApi={(a) => (listApi = a)} active={props.active} />
          </Match>
          <Match when={filter() === "liked"}>
            <SongList list="liked" label={t("w2_lib_chip_liked")} testid="liked-table" emptyKey="w2_lib_empty_liked" onApi={(a) => (listApi = a)} active={props.active} />
          </Match>
          <Match when={filter() === "downloaded"}>
            <SongList list="downloaded" label={t("w2_downloaded")} testid="downloads-table" emptyKey="w2_lib_empty_downloads" onApi={(a) => (listApi = a)} active={props.active} />
          </Match>
          <Match when={isCardList(filter())}>
            <div class="lb-tools">
              <FilterField value={text} onInput={onText} placeholder={t("w2_lib_filter_ph")} label={t("w2_lib_filter_ph")} />
              <div class="f1" />
              <span class="t12 i3 num" data-testid="lib-count">
                {plural("w2_lib_items_n", total())}
              </span>
            </div>
            <CardGrid list={filter() as CardList} view={view()} text={applied} sort={cardSort()} label={chipLabel(filter())} onTotal={setTotal} />
          </Match>
        </Switch>
      </div>
    </div>
  );
}

export const routes: RouteName[] = ["library"];
export default Library;
