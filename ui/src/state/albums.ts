import { client } from "../lib/core";

export type AlbumItem = { id: string; title: string; subtitle?: string; art?: any };

/** User albums for the sidebar and Library. Cores without userAlbum.list (mock) fall back to Home album cards. */
export async function loadAlbums(): Promise<AlbumItem[]> {
  try {
    return (await client.call<{ items: AlbumItem[] }>("userAlbum.list")).items;
  } catch {
    const h = await client.call<any>("home.get", {});
    const cards = h.shelves.filter((x: any) => x.layout === "cards").flatMap((x: any) => x.items).filter((i: any) => i.t !== "artist");
    return cards.slice(0, 6).map((c: any) => ({ id: c.id, title: c.title, subtitle: c.subtitle ?? (c.artists ?? []).map((a: any) => a.name).join(", "), art: c.art }));
  }
}
