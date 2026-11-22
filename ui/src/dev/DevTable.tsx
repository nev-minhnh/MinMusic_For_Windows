import { For, createSignal, onCleanup, onMount } from "solid-js";
import { Table, createTableSelection } from "../components/Table";
import { Card } from "../components/Card";
import { openMenu } from "../components/Menu";
import { userAlbumMenu } from "../menus/userAlbum";
import { delegate } from "../lib/delegate";
import { createWindowStore } from "../state/library";
import { player, playerState } from "../state/player";
import { userAlbums } from "../state/userAlbums";
import { navigate } from "../router/router";
import { t } from "../i18n";
import type { SortSpec } from "../lib/types";

/** Dev and e2e only (`#/dev/table`): the shared Table and Card on the 5,000-song mock library, so the foundation is testable without a page WP. */
export default function DevTable() {
  const store = createWindowStore("songs", { by: "added", desc: true } as SortSpec);
  const sel = createTableSelection(store.total, (i) => void player.play({ kind: "library", list: "songs", sort: store.sort() }, { startIndex: i }));
  const [sort, setSort] = createSignal<SortSpec>(store.sort());
  let cards!: HTMLDivElement;
  onMount(() => {
    store.ensure(0, 100);
    const off = delegate(cards);
    onCleanup(off);
  });
  return (
    <div class="pg" data-testid="dev-table" tabindex="-1">
      <div class="sc">
        <div class="shelf" ref={cards} data-testid="dev-cards" style={{ "margin-top": "16px" }}>
          <For each={userAlbums.all().slice(0, 4)}>
            {(a) => (
              <Card
                title={a.title}
                subtitle={a.subtitle}
                art={a.art}
                dataKey={a.id}
                playLabel={t("w2_play")}
                onOpen={() => navigate("userAlbum", { id: a.id })}
                onContext={(e) => openMenu(userAlbumMenu(a), { x: e.clientX, y: e.clientY })}
              />
            )}
          </For>
        </div>
        <Table
          label={t("w2_chip_songs")}
          total={store.total}
          trackAt={(i) => store.track(i)}
          ensure={store.ensure}
          sort={sort()}
          onSort={(s) => (setSort(s), store.setSort(s))}
          sel={sel}
          playingId={() => playerState()?.track?.id}
          onPlay={(i) => void player.play({ kind: "library", list: "songs", sort: store.sort() }, { startIndex: i })}
        />
      </div>
    </div>
  );
}
