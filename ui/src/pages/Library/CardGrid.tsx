import { Index, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Card } from "../../components/Card";
import { Art } from "../../components/Art";
import { Icon } from "../../components/Icon";
import { VirtualList } from "../../components/VirtualList";
import { openMenu } from "../../components/Menu";
import { createWindowStore } from "../../state/library";
import { delegate, type CtxEvent } from "../../lib/delegate";
import { cardMenu, contextOf } from "../../menus/card";
import { player } from "../../state/player";
import { navigate } from "../../router/router";
import { wClass } from "../../lib/layout";
import { artistsText } from "../../lib/format";
import { t, plural } from "../../i18n";
import { gridCols } from "./util";
import type { Item, FilterSpec } from "../../lib/types";

export type CardList = "albums" | "artists" | "playlists";

/** Card width and gap per width class: the same numbers as `--cw` and the shelf gap in base.css. */
export const CARD_W = { expanded: 184, medium: 160, compact: 144 } as const;
/** card = art (square) + 8 margin + 20 title + 18 subtitle, then a 24 gap: a fixed row height, so the grid can be virtualised without measuring */
export const cardRowHeight = (cw: number) => cw + 46 + 24;
export const LIST_ROW_H = 56;

type Raw = { id: string; title?: string; name?: string; art?: any; artists?: { name: string }[]; subtitle?: string; year?: number; local?: boolean; count?: number; source?: any; kind?: string };

/** The `Item` a card stands for (the core sends bare cards in these lists). */
export function itemOf(list: CardList, r: Raw): Item {
  const base = { ...r, source: r.source ?? "yt" } as any;
  if (list === "albums") return { ...base, t: "album", artists: r.artists ?? [], kind: r.kind ?? "album" };
  if (list === "artists") return { ...base, t: "artist", name: r.name ?? r.title ?? "" };
  return { ...base, t: "playlist", local: !!r.local, title: r.title ?? "" };
}
const titleOf = (it: Item) => (it.t === "artist" ? it.name : it.title);
const subtitleOf = (it: Item) => (it.t === "album" ? [artistsText(it.artists), it.year].filter(Boolean).join(" · ") : it.t === "artist" ? it.subtitle ?? "" : it.t === "playlist" ? it.subtitle ?? "" : "");
function open(it: Item) {
  if (it.t === "album") navigate("album", { id: it.id });
  else if (it.t === "artist") navigate("artist", { id: it.id });
  else if (it.t === "playlist") navigate(it.local ? "userAlbum" : "playlist", { id: it.id });
}

/**
 * Albums / artists / playlists of the Library: a virtualised card grid (fixed row height, columns = floor((W+gap)/(card+gap))) or,
 * in list view, 56 px rows. Rows come from `library.window` in chunks of 100 (an index is row * columns + column).
 */
export function CardGrid(props: { list: CardList; view: "grid" | "list"; text: () => string; label: string; sort?: { by: any; desc: boolean }; onTotal?: (n: number) => void }) {
  const store = createWindowStore<Raw>(props.list, props.sort ?? { by: "added", desc: true });
  let wrap!: HTMLDivElement;
  const [width, setWidth] = createSignal(1000);
  const cw = () => CARD_W[wClass()];
  const gap = () => (wClass() === "compact" ? 16 : 24);
  const cols = () => (props.view === "list" ? 1 : gridCols(width(), cw(), gap()));
  const rows = () => Math.ceil(store.total() / cols());
  const rowH = () => (props.view === "list" ? LIST_ROW_H : cardRowHeight(cw()));
  const [settled, setSettled] = createSignal(false);

  createEffect(() => props.onTotal?.(store.total()));
  let lastSort = props.sort;
  createEffect(() => {
    const s = props.sort;
    if (s && lastSort && (s.by !== lastSort.by || s.desc !== lastSort.desc)) store.setSort(s);
    lastSort = s;
  });
  let lastText = "";
  createEffect(() => {
    const s = props.text().trim();
    if (s === lastText) return;
    lastText = s;
    store.setFilter(s ? { text: s } : (undefined as FilterSpec | undefined));
  });

  const itemAt = (idx: number): Item | undefined => {
    const r = store.track(idx);
    return r ? itemOf(props.list, r) : undefined;
  };
  const onCtx = (idx: number) => (e: CtxEvent) => {
    const it = itemAt(idx);
    if (it) openMenu(cardMenu(it), { x: e.clientX, y: e.clientY });
  };

  onMount(() => {
    store.ensure(0, 100); // the VirtualList only exists once the total is known
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(wrap);
    setWidth(wrap.clientWidth || 1000);
    const off = delegate(wrap);
    const id = setTimeout(() => setSettled(true), 500);
    onCleanup(() => {
      ro.disconnect();
      off();
      clearTimeout(id);
    });
  });

  const cell = (idx: () => number) => {
    const it = () => itemAt(idx());
    return (
      <Show when={it()}>
        {(x) => (
          <Card
            title={titleOf(x())}
            subtitle={subtitleOf(x())}
            art={(x() as any).art}
            dataKey={String(idx())}
            onOpen={() => open(x())}
            onPlay={() => {
              const c = contextOf(x());
              if (c) void player.play(c);
            }}
            playLabel={t("w2_play")}
            onContext={onCtx(idx())}
          />
        )}
      </Show>
    );
  };
  const lrow = (idx: () => number) => {
    const it = () => itemAt(idx());
    return (
      <Show when={it()} fallback={<div class="lb-lrow lb-lrow-skel" aria-hidden="true" />}>
        {(x) => (
          <div
            class="lb-lrow"
            role="row"
            data-testid="lib-lrow"
            tabindex="-1"
            data-key={String(idx())}
            onClick={() => open(x())}
            onDblClick={() => {
              const c = contextOf(x());
              if (c) void player.play(c);
            }}
          >
            <Art art={(x() as any).art} size={40} class="pressable" />
            <div class="f1" style={{ "min-width": "0" }}>
              <div class="w6 ell">{titleOf(x())}</div>
              <div class="t12 i3 ell">{subtitleOf(x())}</div>
            </div>
          </div>
        )}
      </Show>
    );
  };
  const colIdx = () => Array.from({ length: cols() }, (_, k) => k);

  return (
    <div ref={wrap} class="lb-cards" data-testid="lib-cards" data-view={props.view} data-count={store.total()}>
      <Show when={store.total() > 0}>
        {/* a different view or width class changes the row height: remount the list so VirtualList starts from the new height */}
        <Show when={`${props.view}:${rowH()}`} keyed>
          {(_k) => (
            <VirtualList
              total={rows()}
              rowHeight={rowH()}
              testid="lib-card-list"
              label={props.label}
              onRange={(s, e) => store.ensure(s * cols(), e * cols())}
              render={(i) =>
                props.view === "grid" ? (
                  <div class="lb-grid" style={{ "grid-template-columns": `repeat(${cols()}, ${cw()}px)` }}>
                    <Index each={colIdx()}>{(k) => cell(() => i() * cols() + k())}</Index>
                  </div>
                ) : (
                  lrow(i)
                )
              }
            />
          )}
        </Show>
      </Show>
      <Show when={store.total() === 0 && settled()}>
        <div class="empty-state" data-testid="lib-empty">
          <Icon n="music_note" s={32} />
          <div>{props.text().trim() ? t("w2_lib_empty_filter") : t("w2_lib_empty_cards")}</div>
        </div>
      </Show>
    </div>
  );
}

export const cardCountText = (n: number) => plural("w2_lib_items_n", n);
