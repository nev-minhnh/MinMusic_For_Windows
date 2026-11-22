// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildPages, pageFor } from "./registry";
import { ROUTE_NAMES } from "./routes";
import { initial, pushOp, backOp, mountedOf, KEEP_ALIVE } from "./router";

const A = (() => null) as any;
const B = (() => null) as any;
const M = (() => null) as any;

describe("route registry", () => {
  it("lists every frontend-spec route", () => {
    for (const r of ["home", "search", "library", "liked", "downloads", "history", "stats", "album", "userAlbum", "artist", "artistAbout", "playlist", "podcast", "charts", "browse", "equalizer", "settings", "listenTogether", "onboarding"]) {
      expect(ROUTE_NAMES).toContain(r);
    }
  });
  it("maps routes to the default export of the page that claims them", () => {
    const pages = buildPages({ "../pages/Home/index.tsx": { routes: ["home"], default: A }, "../pages/Lib/index.tsx": { routes: ["library", "liked"], default: B } });
    expect(pageFor(pages, "home", M)).toBe(A);
    expect(pageFor(pages, "liked", M)).toBe(B);
  });
  it("falls back to the missing page for a route nobody registered", () => {
    const pages = buildPages({ "../pages/Home/index.tsx": { routes: ["home"], default: A } });
    expect(pageFor(pages, "stats", M)).toBe(M);
    expect(pageFor(pages, "nope", M)).toBe(M);
  });
  it("ignores modules without routes (the _Missing page itself) and rejects duplicate claims", () => {
    expect(Object.keys(buildPages({ x: { routes: [], default: M } }))).toEqual([]);
    expect(() => buildPages({ a: { routes: ["home"], default: A }, b: { routes: ["home"], default: B } })).toThrow(/claimed by both a and b/);
  });
});

describe("keep-alive (unchanged)", () => {
  it("keeps the current page and the 4 previous entries mounted", () => {
    let s = initial();
    for (let i = 0; i < 8; i++) s = pushOp(s, { name: "album", params: { id: String(i) }, key: `k${i}` });
    expect(mountedOf(s)).toHaveLength(KEEP_ALIVE);
    expect(mountedOf(backOp(s))).toHaveLength(KEEP_ALIVE);
  });
});
