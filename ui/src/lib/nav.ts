import { navigate } from "../router/router";
import { isRouteName } from "../router/routes";
import type { Item, NavTarget } from "./types";
import { client } from "./core";

const str = (p: object | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p ?? {})) if (v != null) out[k] = String(v);
  return out;
};

/** api.md NavTarget -> router. Unknown routes are logged and ignored. */
export function navTo(t: NavTarget): void {
  if (!isRouteName(t.route)) {
    client.call("app.log", { level: "warn", msg: `navTo: unknown route "${t.route}"` }).catch(() => {});
    return;
  }
  navigate(t.route, str(t.params));
}

/** The NavTarget a click on an item opens (default click rules, frontend-spec 7), or null when it has no page. */
export function targetOf(item: Item): NavTarget | null {
  switch (item.t) {
    case "track":
      if (item.album?.id) return { route: "album", params: { id: item.album.id } };
      if (item.artists[0]?.id) return { route: "artist", params: { id: item.artists[0].id } };
      return null;
    case "album":
      return { route: "album", params: { id: item.id } };
    case "artist":
      return { route: "artist", params: { id: item.id } };
    case "playlist":
      return { route: item.local ? "userAlbum" : "playlist", params: { id: item.id } };
  }
}

export function openItem(item: Item): void {
  const t = targetOf(item);
  if (t) navTo(t);
}
