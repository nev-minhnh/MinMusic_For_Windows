import { describe, expect, it } from "vitest";
import { WindowCache, CHUNK, type WindowChunk } from "./stores/library.ts";

function fake(total = 5000) {
  let revision = 1;
  const calls: number[] = [];
  const fetcher = async (offset: number, limit: number): Promise<WindowChunk<number>> => {
    calls.push(offset);
    const items: number[] = [];
    for (let i = offset; i < Math.min(offset + limit, total); i++) items.push(i);
    return { total, revision, offset, items };
  };
  return { fetcher, calls, bump: () => ++revision };
}

describe("WindowCache", () => {
  it("fetches aligned chunks of 100 and serves rows from them", async () => {
    const f = fake();
    const c = new WindowCache<number>(f.fetcher);
    await c.ensure(250, 330);
    expect(f.calls).toEqual([200, 300]);
    expect(c.itemAt(250)).toBe(250);
    expect(c.itemAt(399)).toBe(399);
    expect(c.itemAt(400)).toBeUndefined();
    expect(c.total).toBe(5000);
  });
  it("does not refetch cached chunks and shares in-flight fetches", async () => {
    const f = fake();
    const c = new WindowCache<number>(f.fetcher);
    await Promise.all([c.ensure(0, 100), c.ensure(10, 50), c.ensure(0, 100)]);
    expect(f.calls).toEqual([0]);
    await c.ensure(0, 100);
    expect(f.calls).toEqual([0]);
  });
  it("the last chunk is short and rows beyond total are not requested", async () => {
    const f = fake();
    const c = new WindowCache<number>(f.fetcher);
    await c.ensure(4950, 5000);
    expect(c.itemAt(4999)).toBe(4999);
    expect(c.itemAt(5000)).toBeUndefined();
    expect(c.missing(4900, 6000)).toEqual([]);
  });
  it("invalidate(revision) drops chunks older than that revision", async () => {
    const f = fake();
    const c = new WindowCache<number>(f.fetcher);
    await c.ensure(0, 300);
    const rev = f.bump();
    expect(c.invalidate(rev).sort()).toEqual([0, 100, 200]);
    expect(c.itemAt(5)).toBeUndefined();
    await c.ensure(100, 200);
    expect(c.cachedChunks).toEqual([100]);
    expect(c.invalidate(rev)).toEqual([]); // chunks at the current revision survive
  });
  it("a fetch that returns a newer revision invalidates the older chunks", async () => {
    const f = fake();
    const c = new WindowCache<number>(f.fetcher);
    await c.ensure(0, 200);
    f.bump();
    await c.ensure(300, 400); // fetched at revision 2
    expect(c.cachedChunks).toEqual([300]);
    expect(c.revision).toBe(2);
  });
  it("uses CHUNK = 100", () => expect(CHUNK).toBe(100));
});
