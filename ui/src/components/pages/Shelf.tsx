import { For, Show } from "solid-js";
import { Card } from "../Card";
import { IconButton } from "../IconButton";
import { openMenu } from "../Menu";
import { cardMenu, contextOf } from "../../menus/card";
import { navTo, openItem, targetOf } from "../../lib/nav";
import { player } from "../../state/player";
import { artistsText } from "../../lib/format";
import { t } from "../../i18n";
import type { Item, NavTarget } from "../../lib/types";
import "./pages.css";

export const itemTitle = (it: Item): string => (it.t === "artist" ? it.name : it.title);
export const itemSub = (it: Item): string => {
  switch (it.t) {
    case "track":
    case "album":
      return artistsText(it.artists);
    default:
      return it.subtitle ?? "";
  }
};

function playItem(it: Item) {
  if (it.t === "track") return void player.play({ kind: "tracks", ids: [it.id] });
  const c = contextOf(it);
  if (c) void player.play(c);
}

/**
 * Horizontal card shelf for the collection pages (same markup and classes as the Home shelf: 184 cards, back/forward buttons,
 * scrolls only through the buttons, Shift+wheel and touchpad; a vertical wheel goes on to the page).
 */
export function PageShelf(props: { title: string; items: Item[]; more?: NavTarget; below?: boolean; testid?: string }) {
  let sc!: HTMLDivElement;
  const by = (dir: number) => sc.scrollBy({ left: dir * 3 * (184 + 24), behavior: "smooth" });
  return (
    <Show when={props.items.length}>
      <section class="sec" classList={{ below: props.below }} data-testid={props.testid ?? "shelf-section"}>
        <div class="sh">
          <h3>{props.title}</h3>
          <Show when={props.more}>
            <button type="button" class="more btn txt" onClick={() => navTo(props.more!)}>
              {t("w2_see_all")}
            </button>
          </Show>
          <IconButton icon="back" label={t("w2_scroll_left")} tonal onClick={() => by(-1)} testid="shelf-left" />
          <IconButton icon="right" label={t("w2_scroll_right")} tonal onClick={() => by(1)} testid="shelf-right" />
        </div>
        <div class="shelf" ref={sc} data-testid="shelf">
          <For each={props.items}>
            {(it) => (
              <Card
                title={itemTitle(it)}
                subtitle={itemSub(it)}
                art={it.art}
                size={184}
                playLabel={t("w2_play")}
                onOpen={() => (it.t !== "track" && targetOf(it) ? openItem(it) : playItem(it))}
                onPlay={() => playItem(it)}
                dataKey={it.id}
                onContext={(e) => openMenu(cardMenu(it), { x: e.clientX, y: e.clientY })}
              />
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}
