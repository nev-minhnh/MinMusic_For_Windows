import type { MenuItem } from "../../menus/types";
import { songMenu } from "../../menus/song";
import { cardMenu, contextOf } from "../../menus/card";
import { artistsText } from "../../lib/format";
import { player } from "../../state/player";
import type { Item, Track } from "../../lib/types";

export const itemTitle = (it: Item): string => (it.t === "artist" ? it.name : it.title);

export function itemSub(it: Item): string {
  switch (it.t) {
    case "track":
      return artistsText(it.artists);
    case "album":
      return [artistsText(it.artists), it.year].filter(Boolean).join(" · ");
    default:
      return it.subtitle ?? "";
  }
}

/** The play context of an item: a track plays alone, everything else through its container. */
export function playItem(it: Item): void {
  if (it.t === "track") void player.play({ kind: "tracks", ids: [it.id], title: it.title });
  else {
    const ctx = contextOf(it);
    if (ctx) void player.play(ctx);
  }
}

export const menuFor = (it: Item): MenuItem[] => (it.t === "track" ? songMenu([it as Track], {}) : cardMenu(it));

/** `{kind:"tracks", ids, title}` + startIndex for a list of tracks: the whole list plays, not one song. */
export function playList(tracks: { id: string }[], startIndex: number, title?: string): void {
  void player.play({ kind: "tracks", ids: tracks.map((x) => x.id), title }, { startIndex });
}
