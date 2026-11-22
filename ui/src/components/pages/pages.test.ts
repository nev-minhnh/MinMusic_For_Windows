// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { isStuck, observeSentinel, type IOCtor } from "./stickyBar";
import { createCursorList } from "./cursorList";
import { cacheClear, cacheGet, cacheSet, createPageData } from "./pageCache";
import { albumContext, artistContext, playExtra, playlistContext, radioContext } from "./playContext";

describe("header collapse sentinel", () => {
  it("is stuck exactly when the sentinel is out of view", () => {
    expect(isStuck([{ isIntersecting: true }])).toBe(false);
    expect(isStuck([{ isIntersecting: false }])).toBe(true);
    expect(isStuck([{ isIntersecting: false }, { isIntersecting: true }])).toBe(false); // last entry wins
  });
  it("reports changes only, and disconnects", () => {
    let cb: (e: { isIntersecting: boolean }[]) => void = () => {};
    const disconnect = vi.fn();
    const observe = vi.fn();
    const IO = function (this: unknown, c: typeof cb) {
      cb = c;
      return { observe, disconnect };
    } as unknown as IOCtor;
    const seen: boolean[] = [];
    const off = observeSentinel(document.createElement("div"), (s) => seen.push(s), IO);
    expect(observe).toHaveBeenCalledOnce();
    cb([{ isIntersecting: true }]);
    cb([{ isIntersecting: true }]);
    cb([{ isIntersecting: false }]);
    cb([{ isIntersecting: false }]);
    cb([{ isIntersecting: true }]);
    expect(seen).toEqual([false, true, false]);
    off();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

describe("cursor list store", () => {
  const pages: Record<string, { items: number[]; next: string | null }> = {
    "": { items: [1, 2], next: "a" },
    a: { items: [3, 4], next: "b" },
    b: { items: [5], next: null },
  };
  const mk = (calls: (string | undefined)[] = []) =>
    createCursorList<number>(async (c) => (calls.push(c), pages[c ?? ""]!));
  it("appends pages in order and stops at the end", async () => {
    await createRoot(async (dispose) => {
      const calls: (string | undefined)[] = [];
      const l = mk(calls);
      expect(l.hasMore()).toBe(true);
      await l.loadMore();
      await l.loadMore();
      await l.loadMore();
      await l.loadMore(); // no next: ignored
      expect(l.items()).toEqual([1, 2, 3, 4, 5]);
      expect(calls).toEqual([undefined, "a", "b"]);
      expect(l.hasMore()).toBe(false);
      dispose();
    });
  });
  it("ignores a call while one is in flight (a page is never requested twice)", async () => {
    await createRoot(async (dispose) => {
      const calls: (string | undefined)[] = [];
      const l = mk(calls);
      await Promise.all([l.loadMore(), l.loadMore(), l.loadMore()]);
      expect(calls).toEqual([undefined]);
      dispose();
    });
  });
  it("keeps the error and lets a retry continue", async () => {
    await createRoot(async (dispose) => {
      let fail = true;
      const l = createCursorList<number>(async () => {
        if (fail) throw new Error("x");
        return { items: [9], next: null };
      });
      await l.loadMore();
      expect(l.error()).toBeTruthy();
      expect(l.items()).toEqual([]);
      fail = false;
      await l.loadMore();
      expect(l.items()).toEqual([9]);
      expect(l.error()).toBeUndefined();
      dispose();
    });
  });
  it("a store built on a cache key starts with the loaded pages and does not refetch", async () => {
    cacheClear();
    await createRoot(async (dispose) => {
      const calls: (string | undefined)[] = [];
      const a = createCursorList<number>(async (c) => (calls.push(c), pages[c ?? ""]!), "k");
      await a.loadMore();
      await a.loadMore();
      const b = createCursorList<number>(async (c) => (calls.push(c), pages[c ?? ""]!), "k"); // the page mounts again
      expect(b.items()).toEqual([1, 2, 3, 4]);
      await b.loadMore(); // continues from the stored cursor
      expect(calls).toEqual([undefined, "a", "b"]);
      expect(b.items()).toEqual([1, 2, 3, 4, 5]);
      dispose();
    });
  });
  it("reset reloads the first page", async () => {
    await createRoot(async (dispose) => {
      const calls: (string | undefined)[] = [];
      const l = mk(calls);
      await l.loadMore();
      await l.loadMore();
      await l.reset();
      expect(l.items()).toEqual([1, 2]);
      expect(calls).toEqual([undefined, "a", undefined]);
      dispose();
    });
  });
});

describe("page store", () => {
  beforeEach(() => cacheClear());
  it("fetches once per key; a page mounted again (back) shows the stored value without a call", async () => {
    const fetcher = vi.fn(async () => ({ n: 1 }));
    await createRoot(async (dispose) => {
      const a = createPageData(() => "album:1", fetcher);
      await vi.waitFor(() => expect(a.data()).toEqual({ n: 1 }));
      dispose();
    });
    await createRoot(async (dispose) => {
      const b = createPageData(() => "album:1", fetcher);
      expect(b.data()).toEqual({ n: 1 }); // synchronous, from the store
      dispose();
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("mutate writes through to the store", async () => {
    cacheSet("k", { saved: false });
    await createRoot(async (dispose) => {
      const a = createPageData<{ saved: boolean }>(() => "k", async () => ({ saved: false }));
      a.mutate((v) => ({ ...v, saved: true }));
      expect(cacheGet<{ saved: boolean }>("k")?.saved).toBe(true);
      dispose();
    });
  });
});

describe("play contexts", () => {
  it("builds the context per page", () => {
    expect(albumContext("A")).toEqual({ kind: "album", id: "A" });
    expect(playlistContext("P")).toEqual({ kind: "playlist", id: "P" });
    expect(artistContext("U")).toEqual({ kind: "artist", id: "U" });
    expect(radioContext("U")).toEqual({ kind: "radio", id: "U" });
  });
  it("Phát / Trộn bài / double-click extras", () => {
    expect(playExtra()).toEqual({});
    expect(playExtra({ shuffle: true })).toEqual({ shuffle: true });
    expect(playExtra({ startId: "t1" })).toEqual({ startId: "t1" });
    expect(playExtra({ shuffle: false, startId: "t1" })).toEqual({ startId: "t1" });
  });
});
