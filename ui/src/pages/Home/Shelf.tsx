import { For, Show, onCleanup, onMount } from "solid-js";
import { Card } from "../../components/Card";
import { IconButton } from "../../components/IconButton";
import { openMenu } from "../../components/Menu";
import { delegate } from "../../lib/delegate";
import { openItem, navTo } from "../../lib/nav";
import { Table } from "../../components/Table";
import { navigate } from "../../router/router";
import { t } from "../../i18n";
import { itemSub, itemTitle, menuFor, playItem, playList } from "./items";
import type { Item, Shelf as ShelfT } from "../../lib/types";

/** One card of a shelf: open on click, play on the FAB, context menu through the shelf delegate. */
export function ItemCard(props: { item: Item; size?: number }) {
  const it = () => props.item;
  return (
    <Card
      title={itemTitle(it())}
      subtitle={itemSub(it())}
      art={it().art}
      size={props.size}
      dataKey={it().id}
      playLabel={t("w2_play")}
      onOpen={() => openItem(it())}
      onPlay={() => playItem(it())}
      onContext={(e) => openMenu(menuFor(it()), { x: e.clientX, y: e.clientY })}
    />
  );
}

/**
 * Shelf of 184 cards with the two 36 buttons. The buttons scroll by one visible width (`scrollBy`, smooth, button-driven only):
 * the vertical wheel is never mapped to horizontal. Below the fold the section uses content-visibility:auto (CSS `.sec.below`).
 */
export function Shelf(props: { shelf: ShelfT; below?: boolean; round?: boolean; testid?: string }) {
  let sc!: HTMLDivElement;
  const by = (dir: number) => sc.scrollBy({ left: dir * sc.clientWidth, behavior: "smooth" });
  onMount(() => onCleanup(delegate(sc)));
  return (
    <section class="sec" classList={{ below: props.below, "shelf-round": props.round }} data-testid={props.testid ?? "shelf-section"} data-shelf={props.shelf.key}>
      <div class="sh">
        <h3>{props.shelf.title}</h3>
        <Show when={props.shelf.more}>
          {(m) => (
            <button type="button" class="more" onClick={() => navTo(m())}>
              {t("w2_see_all")}
            </button>
          )}
        </Show>
        <IconButton icon="back" label={t("w2_scroll_left")} tonal testid="shelf-prev" onClick={() => by(-1)} />
        <IconButton icon="right" label={t("w2_scroll_right")} tonal testid="shelf-next" onClick={() => by(1)} />
      </div>
      <div class="shelf" ref={sc} data-testid="shelf">
        <For each={props.shelf.items}>{(it) => <ItemCard item={it} />}</For>
      </div>
    </section>
  );
}

/** Placeholder shelf shown within one frame while data is on its way (12 px r6 surface3 bars, frontend-spec 6.2). */
export function ShelfSkeleton() {
  return (
    <section class="sec" data-testid="shelf-skeleton" aria-hidden="true">
      <div class="sh">
        <div class="skel" style={{ width: "180px", height: "20px" }} />
      </div>
      <div class="shelf">
        <For each={[0, 1, 2, 3, 4, 5]}>
          {() => (
            <div class="card">
              <div class="art skel-sq" />
              <div class="skel" style={{ width: "70%", "margin-top": "10px" }} />
            </div>
          )}
        </For>
      </div>
    </section>
  );
}


/** A "rows" shelf (tracks): a short Table; a double-click plays the shelf from that row. */
export function RowsShelf(props: { shelf: ShelfT; below?: boolean }) {
  const tracks = () => props.shelf.items.filter((i): i is Item & { t: "track" } => i.t === "track");
  return (
    <section class="sec" classList={{ below: props.below }} data-testid="rows-section">
      <div class="sh">
        <h3>{props.shelf.title}</h3>
      </div>
      <Table
        total={() => tracks().length}
        trackAt={(i) => tracks()[i]}
        label={props.shelf.title}
        testid="rows-table"
        header={false}
        cols={["index", "title", "album", "dur", "more"]}
        onPlay={(i) => playList(tracks(), i, props.shelf.title)}
        onOpenAlbum={(tr) => tr.album?.id && navigate("album", { id: tr.album.id })}
      />
    </section>
  );
}
