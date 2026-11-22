import { createSignal } from "solid-js";
import { client } from "../lib/core";
import { onLibraryEvent } from "./library";
import type { Art } from "../lib/types";

export type UserAlbum = { id: string; title: string; subtitle?: string; art?: Art; pinned: boolean; count?: number; revision?: number };

const [items, setItems] = createSignal<UserAlbum[]>([]);
const [loaded, setLoaded] = createSignal(false);
export { loaded as userAlbumsLoaded };

/** Pinned first, then the rest, each group in the order the core sent. */
const order = (xs: UserAlbum[]) => [...xs.filter((x) => x.pinned), ...xs.filter((x) => !x.pinned)];

/** userAlbum.list. Cores without it (the M0 mock) fall back to Home album cards so the sidebar has something to show. */
export async function refresh(): Promise<void> {
  try {
    const r = await client.call<{ items: UserAlbum[] }>("userAlbum.list");
    setItems(order(r.items.map((x) => ({ ...x, pinned: !!x.pinned }))));
  } catch {
    try {
      const h = await client.call<any>("home.get", {});
      const cards = h.shelves.filter((x: any) => x.layout === "cards").flatMap((x: any) => x.items).filter((i: any) => i.t !== "artist");
      setItems(
        cards.slice(0, 6).map(
          (c: any, i: number): UserAlbum => ({ id: c.id, title: c.title, subtitle: c.subtitle ?? (c.artists ?? []).map((a: any) => a.name).join(", "), art: c.art, pinned: i < 2 })
        )
      );
    } catch {
      /* offline */
    }
  }
  setLoaded(true);
}

let started = false;
export function initUserAlbums() {
  if (started) return;
  started = true;
  onLibraryEvent((name) => {
    if (name === "userAlbums.changed") refresh();
  });
  refresh();
}

export const userAlbums = {
  /** all albums, pinned first */
  all: items,
  pinned: () => items().filter((x) => x.pinned),
  get: (id: string) => items().find((x) => x.id === id),
  refresh,
  create: async (title: string, trackIds?: string[]) => {
    const r = await client.call<{ id: string }>("userAlbum.create", { title, trackIds });
    await refresh();
    return r.id;
  },
  rename: async (id: string, title: string) => {
    await client.call("userAlbum.rename", { id, title });
    await refresh();
  },
  remove: async (id: string) => {
    await client.call("userAlbum.delete", { id });
    await refresh();
  },
  pin: async (id: string, pinned: boolean) => {
    await client.call("userAlbum.pin", { id, pinned });
    await refresh();
  },
  setCover: async (id: string, path: string | null) => {
    await client.call("userAlbum.setCover", { id, path });
    await refresh();
  },
  add: (id: string, trackIds: string[]) => client.call<{ added: number; skipped: number }>("userAlbum.add", { id, trackIds, dedupe: true }),
};

/** Compat for pages written against the old state/albums.ts. */
export async function loadAlbums(): Promise<UserAlbum[]> {
  if (!loaded()) await refresh();
  return items();
}
