import type { ArtistAboutResult, ArtistGetResult } from "@minmusic/protocol";
import { client } from "../../lib/core";
import { createPageData } from "./pageCache";
import type { AlbumResult } from "../../lib/types";

/** Page-store backed loaders. The key is the page-store key, so Artist and ArtistAbout share one artist.get. */
export const albumData = (id: () => string, method: "album.get" | "podcast.get" = "album.get") =>
  createPageData<AlbumResult>(() => `${method === "album.get" ? "album" : "podcast"}:${id()}`, () => client.call<AlbumResult>(method, { id: id() }));
export const artistData = (id: () => string) => createPageData<ArtistGetResult>(() => `artist:${id()}`, () => client.call<ArtistGetResult>("artist.get", { id: id() }));
export const artistAboutData = (id: () => string) => createPageData<ArtistAboutResult>(() => `artistAbout:${id()}`, () => client.call<ArtistAboutResult>("artist.about", { id: id() }));

export const durationText = (ms: number, t: (k: string, ...a: unknown[]) => string): string => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m >= 60 ? t("w2_dur_hm", Math.floor(m / 60), m % 60) : t("w2_dur_m", m);
};
