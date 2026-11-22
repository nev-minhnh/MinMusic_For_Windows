// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { targetOf } from "./nav";
import type { Item } from "./types";

const base = { id: "x", title: "T", artists: [{ id: "ar1", name: "A" }], source: "yt" as const };
describe("openItem default click rules", () => {
  it("track -> its album, else its artist, else nothing", () => {
    expect(targetOf({ t: "track", ...base, album: { id: "al1", title: "Al" } } as Item)).toEqual({ route: "album", params: { id: "al1" } });
    expect(targetOf({ t: "track", ...base } as Item)).toEqual({ route: "artist", params: { id: "ar1" } });
    expect(targetOf({ t: "track", ...base, artists: [{ name: "A" }] } as Item)).toBeNull();
  });
  it("album -> album, artist -> artist", () => {
    expect(targetOf({ t: "album", ...base, kind: "album" } as Item)).toEqual({ route: "album", params: { id: "x" } });
    expect(targetOf({ t: "artist", id: "ar9", name: "N", source: "yt" } as Item)).toEqual({ route: "artist", params: { id: "ar9" } });
  });
  it("playlist -> userAlbum when local, playlist otherwise", () => {
    expect(targetOf({ t: "playlist", id: "p1", title: "P", source: "local", local: true } as Item)).toEqual({ route: "userAlbum", params: { id: "p1" } });
    expect(targetOf({ t: "playlist", id: "p2", title: "P", source: "yt", local: false } as Item)).toEqual({ route: "playlist", params: { id: "p2" } });
  });
});
