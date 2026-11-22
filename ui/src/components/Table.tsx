import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { Row, ALL_COLS, COL_W, type Col, type RowLabels } from "./Row";
import { VirtualList } from "./VirtualList";
import { openMenu } from "./Menu";
import { delegate, type CtxEvent, type SelectEvent } from "../lib/delegate";
import { createSelection, setActiveList, type Selection } from "../lib/selection";
import { songMenu, type SongMenuCtx } from "../menus/song";
import { player } from "../state/player";
import { t } from "../i18n";
import type { SortSpec, Track } from "../lib/types";

export const ROW_H = 56;
export const HEAD_H = 40;
/** lists up to this many rows render without virtualisation */
export const SHORT_LIST = 60;

/** Columns that survive at a container width: "Đã thêm" goes below 880, "Album" below 720 (frontend-spec 5, Library). */
export function visibleCols(cols: Col[], width: number): Col[] {
  return cols.filter((c) => !(c === "added" && width < 880) && !(c === "album" && width < 720));
}
export const gridTemplate = (cols: Col[]) => cols.map((c) => COL_W[c]).join(" ");

/** Click on a header cell: same column flips direction, a new column starts ascending (date added: newest first). */
export function nextSort(cur: SortSpec | undefined, by: SortSpec["by"]): SortSpec {
  if (cur?.by === by) return { by, desc: !cur.desc };
  return { by, desc: by === "added" || by === "plays" || by === "lastPlayed" };
}

const SORT_BY: Partial<Record<Col, SortSpec["by"]>> = { title: "title", album: "album", added: "added", dur: "duration" };

export type TableApi = {
  sel: Selection;
  scrollToIndex: (i: number) => void;
  selectedIndices: () => number[];
  selectedTracks: () => Track[];
};

/** A selection over row indices ("0", "1", ...). Enter plays the first selected row through `onPlay`. */
export function createTableSelection(total: () => number, onPlay: (i: number) => void): Selection {
  return createSelection(() => Array.from({ length: total() }, (_, i) => String(i)), { onPlay: (keys) => keys.length && onPlay(Number(keys[0])) });
}

/**
 * The songs table (Library, Album, UserAlbum, Playlist, History, Liked): sticky 40 px header with click-to-sort, VirtualList over
 * 60 rows, role=grid with arrow-key row navigation, multi-selection, context menu (right click, Shift F10, the "..." button) and drag.
 * One pointerdown / contextmenu / dragstart listener for the whole table (lib/delegate.ts).
 */
export function Table(props: {
  total: () => number;
  trackAt: (i: number) => Track | undefined;
  /** ask the data store for rows [start, end) */
  ensure?: (start: number, end: number) => void;
  label: string;
  testid?: string;
  cols?: Col[];
  sort?: SortSpec;
  onSort?: (s: SortSpec) => void;
  sel?: Selection;
  playingId?: () => string | undefined;
  onPlay: (index: number) => void;
  onOpenAlbum?: (t: Track) => void;
  showSource?: boolean;
  /** set inside a user album: "Xoá khỏi album" in the menu, drags carry `userAlbum:<id>` so the page can opt in to reorder */
  userAlbumId?: string;
  menuCtx?: (tracks: Track[]) => SongMenuCtx;
  header?: boolean;
  api?: (api: TableApi) => void;
}) {
  let root!: HTMLDivElement;
  let vl: { scrollToIndex: (i: number) => void } | undefined;
  const sel = props.sel ?? createTableSelection(props.total, props.onPlay);
  const [width, setWidth] = createSignal(1000);
  const [active, setActive] = createSignal(-1);
  const [likes, setLikes] = createSignal<Record<string, boolean>>({});
  const cols = createMemo(() => visibleCols(props.cols ?? ALL_COLS, width()));
  const labels = (): RowLabels => ({ like: t("w2_like"), more: t("w2_more"), play: t("w2_play") });
  const from = () => (props.userAlbumId ? `userAlbum:${props.userAlbumId}` : undefined);

  const selectedIndices = () => sel.keys().map(Number);
  const tracksOf = (idx: number[]) => idx.map((i) => props.trackAt(i)).filter((x): x is Track => !!x);
  const api: TableApi = { sel, scrollToIndex: (i) => vl?.scrollToIndex(i), selectedIndices, selectedTracks: () => tracksOf(selectedIndices()) };
  props.api?.(api);

  // --- delegated handlers, resolved per row
  const onSelect = (i: number) => (e: SelectEvent, phase: "down" | "click") => {
    const key = String(i);
    const plain = !e.ctrlKey && !e.metaKey && !e.shiftKey;
    // pressing on a row of a multi-selection must not collapse it before a drag can start: collapse on click instead
    if (plain && sel.has(key) && sel.count() > 1) {
      if (phase === "click") sel.selectOnly(key);
      return;
    }
    if (phase === "down") {
      sel.click(key, e);
      setActive(i);
    }
  };
  const onContext = (i: number) => (e: CtxEvent) => {
    const key = String(i);
    if (!sel.has(key)) sel.selectOnly(key);
    setActive(i);
    const idx = selectedIndices();
    const tracks = tracksOf(idx);
    const base: SongMenuCtx = props.userAlbumId ? { userAlbumId: props.userAlbumId, entryIds: tracks.map((x) => x.setVideoId ?? "").filter(Boolean) } : {};
    openMenu(songMenu(tracks, { ...base, ...props.menuCtx?.(tracks) }), { x: e.clientX, y: e.clientY });
  };
  const dragIds = (i: number) => () => {
    const key = String(i);
    if (!sel.has(key)) sel.selectOnly(key);
    const idx = selectedIndices();
    const ids = tracksOf(idx).map((x) => x.id);
    return ids.length ? { ids, from: from(), indices: idx } : null;
  };
  const like = (tr: Track) => {
    const next = !(likes()[tr.id] ?? tr.liked);
    setLikes((m) => ({ ...m, [tr.id]: next }));
    void player.like(tr.id, next);
  };
  const withLike = (tr: Track | undefined) => (tr && tr.id in likes() ? { ...tr, liked: likes()[tr.id] } : tr);

  // --- keyboard: arrow-key row navigation (role=grid)
  const focusRow = (i: number) => {
    const scroller = root.closest<HTMLElement>(".pg");
    const el = root.querySelector<HTMLElement>(`[data-key="${i}"]`);
    if (el && scroller) {
      const r = el.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      if (r.top < s.top + HEAD_H) scroller.scrollTop -= s.top + HEAD_H - r.top;
      else if (r.bottom > s.bottom) scroller.scrollTop += r.bottom - s.bottom;
      el.focus({ preventScroll: true });
    } else {
      vl?.scrollToIndex(Math.max(0, i - 2));
      requestAnimationFrame(() => requestAnimationFrame(() => root.querySelector<HTMLElement>(`[data-key="${i}"]`)?.focus({ preventScroll: true })));
    }
  };
  const move = (to: number, extend: boolean) => {
    const n = props.total();
    if (!n) return;
    const i = Math.max(0, Math.min(n - 1, to));
    if (extend) sel.click(String(i), { shiftKey: true });
    else sel.selectOnly(String(i));
    setActive(i);
    focusRow(i);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (sel.onKeyDown(e)) {
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const cur = active() >= 0 ? active() : -1;
    const k = e.key;
    const to = k === "ArrowDown" ? cur + 1 : k === "ArrowUp" ? Math.max(0, cur - 1) : k === "Home" ? 0 : k === "End" ? props.total() - 1 : k === "PageDown" ? cur + 10 : k === "PageUp" ? cur - 10 : null;
    if (to === null) return;
    e.preventDefault(); // the global handler skips keys a list already took (volume stays untouched)
    move(to, e.shiftKey && (k === "ArrowDown" || k === "ArrowUp"));
  };

  // a short list is one chunk: ask for it whole (total is 0 until the first reply)
  createEffect(() => {
    const n = props.total();
    if (n <= SHORT_LIST) props.ensure?.(0, Math.max(n, 1));
  });

  onMount(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(root);
    setWidth(root.clientWidth || 1000);
    const off = delegate(root);
    const focusIn = () => setActiveList({ ids: () => tracksOf(selectedIndices()).map((x) => x.id) });
    root.addEventListener("focusin", focusIn);
    onCleanup(() => {
      ro.disconnect();
      off();
      root.removeEventListener("focusin", focusIn);
      setActiveList(null);
    });
  });

  const renderRow = (i: Accessor<number>) => (
    <Row
      index={i()}
      track={withLike(props.trackAt(i()))}
      dataKey={String(i())}
      selected={sel.has(String(i()))}
      playing={!!props.trackAt(i()) && props.playingId?.() === props.trackAt(i())!.id}
      cols={cols()}
      labels={labels()}
      showSource={props.showSource}
      draggable
      onSelect={onSelect(i())}
      onContext={onContext(i())}
      dragIds={dragIds(i())}
      onPlay={() => props.onPlay(i())}
      onOpenAlbum={props.onOpenAlbum}
      onLike={like}
    />
  );
  const head = (c: Col) => {
    const by = SORT_BY[c];
    const label = c === "index" ? "#" : c === "dur" ? "⏱" : c === "title" ? t("w2_col_title") : c === "album" ? t("w2_col_album") : c === "added" ? t("w2_col_added") : "";
    const on = () => !!by && props.sort?.by === by;
    return (
      <div
        role="columnheader"
        class={`th-${c}`}
        classList={{ srt: !!by, "srt-on": on(), "c-album": c === "album", "c-added": c === "added" }}
        aria-sort={on() ? (props.sort!.desc ? "descending" : "ascending") : undefined}
        data-testid={by ? `th-${c}` : undefined}
        style={c === "index" ? { "text-align": "center" } : c === "dur" ? { "text-align": "right" } : undefined}
        onClick={by && props.onSort ? () => (sel.clear(), props.onSort!(nextSort(props.sort, by))) : undefined}
      >
        {label}
        <Show when={on()}>
          <span class="srt-a" aria-hidden="true">
            {props.sort!.desc ? "↓" : "↑"}
          </span>
        </Show>
      </div>
    );
  };

  return (
    <div
      ref={root}
      class="tbl tbl2"
      role="grid"
      aria-label={props.label}
      aria-rowcount={props.total()}
      aria-multiselectable="true"
      tabindex="0"
      data-testid={props.testid ?? "songs-table"}
      style={{ "--tcols": gridTemplate(cols()) }}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if (e.target === root && props.total() && active() < 0) setActive(0);
      }}
    >
      <Show when={props.header !== false}>
        <div class="th" role="row">
          <For each={cols()}>{(c) => head(c)}</For>
        </div>
      </Show>
      <Show
        when={props.total() > SHORT_LIST}
        fallback={
          <div class="tb-short" role="rowgroup">
            <For each={Array.from({ length: props.total() }, (_, i) => i)}>{(i) => renderRow(() => i)}</For>
          </div>
        }
      >
        <VirtualList
          total={props.total()}
          rowHeight={ROW_H}
          role="rowgroup"
          testid="songs-list"
          label={props.label}
          onRange={(s, e) => props.ensure?.(s, e)}
          ref={(a) => (vl = a)}
          render={renderRow}
        />
      </Show>
    </div>
  );
}
