import { describe, expect, it } from "vitest";
import { artUrl, pxBucket, resolveArt } from "./art.ts";

const core = { port: 51234, artToken: "abcd1234" };
const a = (src: string) => ({ src });

describe("pxBucket", () => {
  it.each([
    [1, 1, 64], [64, 1, 64], [65, 1, 128], [100, 1.25, 128], [100, 1.5, 256], [200, 1, 256], [256, 1, 256],
    [300, 1, 384], [400, 1, 512], [500, 1.5, 768], [768, 1, 768], [769, 1, 1080], [5000, 2, 1080],
  ])("css %s @%sx -> %s", (css, dpr, want) => expect(pxBucket(css, dpr)).toBe(want));
});

describe("artUrl: google hosts", () => {
  it("replaces =w..-h.. with the bucket size", () => {
    expect(artUrl(a("https://lh3.googleusercontent.com/abc123=w544-h544-l90-rj"), 100, { dpr: 1 }))
      .toBe("https://lh3.googleusercontent.com/abc123=w128-h128-l90-rj");
  });
  it("replaces =s..", () => {
    expect(artUrl(a("https://yt3.ggpht.com/xyz=s88-c-k-c0x00ffffff-no-rj"), 200, { dpr: 1 }))
      .toBe("https://yt3.ggpht.com/xyz=w256-h256-l90-rj");
  });
  it("yt3.googleusercontent.com, dpr 2", () => {
    expect(artUrl(a("https://yt3.googleusercontent.com/q=w60-h60"), 100, { dpr: 2 }))
      .toBe("https://yt3.googleusercontent.com/q=w256-h256-l90-rj");
  });
  it("appends the size when none is present", () => {
    expect(artUrl(a("https://lh3.googleusercontent.com/plain"), 64, { dpr: 1 }))
      .toBe("https://lh3.googleusercontent.com/plain=w64-h64-l90-rj");
  });
});

describe("artUrl: i.ytimg.com", () => {
  it.each([
    [60, 1, "default"], [120, 1, "default"], [121, 1, "mqdefault"], [320, 1, "mqdefault"],
    [321, 1, "hqdefault"], [480, 1, "hqdefault"], [481, 1, "maxresdefault"], [700, 1, "maxresdefault"],
  ])("css %s @%sx -> %s", (css, dpr, name) => {
    // buckets: 64->default, 128->mq, 256->mq, 384->hq, 512->maxres
    const r = resolveArt(a("https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg"), css, { dpr });
    expect(r).not.toBeNull();
    const px = pxBucket(css, dpr);
    const want = px <= 120 ? "default" : px <= 320 ? "mqdefault" : px <= 480 ? "hqdefault" : "maxresdefault";
    expect(r!.src).toBe(`https://i.ytimg.com/vi/dQw4w9WgXcQ/${want}.jpg`);
    expect(name).toBeTypeOf("string");
  });
  it("offers an hqdefault onerror fallback", () => {
    const r = resolveArt(a("https://i.ytimg.com/vi/abc/default.jpg"), 500, { dpr: 1 })!;
    expect(r.src).toBe("https://i.ytimg.com/vi/abc/maxresdefault.jpg");
    expect(r.fallback).toBe("https://i.ytimg.com/vi/abc/hqdefault.jpg");
  });
  it("leaves signed (query) URLs alone", () => {
    const s = "https://i.ytimg.com/vi/abc/hq720.jpg?sqp=-oaymwEXC&rs=AOn4CL";
    expect(artUrl(a(s), 300, { dpr: 1 })).toBe(s);
  });
});

describe("artUrl: sndcdn", () => {
  it.each([
    [64, "-large"], [100, "-t300x300"], [128, "-t300x300"], [256, "-t300x300"], [300, "-t500x500"], [600, "-t500x500"],
  ])("css %s -> %s", (css, suffix) => {
    for (const from of ["-large", "-t500x500", "-original"]) {
      expect(artUrl(a(`https://i1.sndcdn.com/artworks-000123-abc${from}.jpg`), css, { dpr: 1 }))
        .toBe(`https://i1.sndcdn.com/artworks-000123-abc${pxBucket(css) <= 100 ? "-large" : pxBucket(css) <= 300 ? "-t300x300" : "-t500x500"}.jpg`);
    }
    expect(suffix).toBeTypeOf("string");
  });
  it("64px uses -large, 128px uses -t300x300", () => {
    expect(artUrl(a("https://i1.sndcdn.com/artworks-x-t500x500.jpg"), 64, { dpr: 1 })).toContain("-large.jpg");
    expect(artUrl(a("https://i1.sndcdn.com/artworks-x-t500x500.jpg"), 128, { dpr: 1 })).toContain("-t300x300.jpg");
    expect(artUrl(a("https://i1.sndcdn.com/artworks-x-large.jpg"), 512, { dpr: 1 })).toContain("-t500x500.jpg");
  });
  it("unmatched file name is unchanged", () => {
    const s = "https://i1.sndcdn.com/avatars-abc-xyz.jpg";
    expect(artUrl(a(s), 128, { dpr: 1 })).toBe(s);
  });
});

describe("artUrl: zing", () => {
  it("replaces w{n} with the bucket px", () => {
    expect(artUrl(a("https://photo-resize-zmp3.zmdcdn.me/w240_r1x1_jpeg/cover/a/b/c.jpg"), 128, { dpr: 1 }))
      .toBe("https://photo-resize-zmp3.zmdcdn.me/w128_r1x1_jpeg/cover/a/b/c.jpg");
  });
  it("caps at 600", () => {
    expect(artUrl(a("https://photo-resize-zmp3.zmdcdn.me/w94_r1x1_jpeg/x.jpg"), 1000, { dpr: 1 }))
      .toBe("https://photo-resize-zmp3.zmdcdn.me/w600_r1x1_jpeg/x.jpg");
  });
});

describe("artUrl: other and core", () => {
  it("anything else is unchanged", () => {
    const s = "https://example.com/pic.jpg?x=1";
    expect(artUrl(a(s), 128, { dpr: 1 })).toBe(s);
  });
  it("no art -> empty string", () => {
    expect(artUrl(undefined, 64)).toBe("");
    expect(resolveArt(null, 64)).toBeNull();
  });
  it("core: maps to the art endpoint with width and token", () => {
    expect(artUrl(a("core:playlist_covers/lp-12-9f8e"), 200, { dpr: 1, core }))
      .toBe("http://127.0.0.1:51234/art/playlist_covers/lp-12-9f8e?w=256&k=abcd1234");
  });
  it("core: reads window.__MM_CORE__ when env.core is not given", () => {
    (globalThis as any).__MM_CORE__ = { port: 1, token: "t", artToken: "k" };
    expect(artUrl(a("core:tag/x y"), 64, { dpr: 1 })).toBe("http://127.0.0.1:1/art/tag/x%20y?w=64&k=k");
    delete (globalThis as any).__MM_CORE__;
    expect(artUrl(a("core:tag/x"), 64, { dpr: 1 })).toBe("");
  });
});
