// Library store: counts + revision from the `library` topic, and `library.window` chunk caches keyed by revision.
import { createSignal, type Accessor } from "solid-js";
import type { FilterSpec, LibraryCounts, LibraryItem, LocalList, SortSpec } from "@minmusic/protocol";
import type { CoreClient } from "../client.ts";

export const CHUNK = 100;

export interface WindowChunk<T> { total: number; revision: number; offset: number; items: T[] }
export type ChunkFetcher<T> = (offset: number, limit: number) => Promise<WindowChunk<T>>;

/**
 * Random-access cache for one (list, sort, filter) view. Chunks are 100 rows aligned to multiples of 100
 * (api.md §1.8). Every chunk remembers the revision it was fetched at; `invalidate(rev)` drops older ones.
 */
export class WindowCache<T = LibraryItem> {
  readonly chunk: number;
  private chunks = new Map<number, { revision: number; items: T[] }>();
  private inflight = new Map<number, Promise<void>>();
  private fetcher: ChunkFetcher<T>;
  total = 0;
  revision = 0;
  /** number of network fetches issued (tests, perf) */
  fetches = 0;

  constructor(fetcher: ChunkFetcher<T>, chunk = CHUNK) {
    this.fetcher = fetcher;
    this.chunk = chunk;
  }

  itemAt(index: number): T | undefined {
    const base = Math.floor(index / this.chunk) * this.chunk;
    return this.chunks.get(base)?.items[index - base];
  }

  hasChunk(base: number): boolean { return this.chunks.has(base); }
  get cachedChunks(): number[] { return [...this.chunks.keys()].sort((a, b) => a - b); }

  /** Chunk base offsets covering [start, end) that are not cached. */
  missing(start: number, end: number): number[] {
    const out: number[] = [];
    const last = this.total > 0 ? Math.min(end, this.total) : end;
    for (let b = Math.floor(start / this.chunk) * this.chunk; b < last; b += this.chunk) {
      if (!this.chunks.has(b)) out.push(b);
    }
    return out;
  }

  /** Drop every chunk fetched at a revision older than `revision`. Returns the dropped chunk bases. */
  invalidate(revision: number): number[] {
    const dropped: number[] = [];
    for (const [b, c] of this.chunks) {
      if (c.revision < revision) { this.chunks.delete(b); dropped.push(b); }
    }
    if (revision > this.revision) this.revision = revision;
    return dropped;
  }

  clear() { this.chunks.clear(); }

  /** Make sure rows [start, end) are cached. Concurrent calls share in-flight fetches. */
  async ensure(start: number, end: number): Promise<void> {
    const need = this.missing(start, end);
    await Promise.all(need.map((b) => this.fetchChunk(b)));
  }

  private fetchChunk(base: number): Promise<void> {
    const cur = this.inflight.get(base);
    if (cur) return cur;
    this.fetches++;
    const p = this.fetcher(base, this.chunk).then((r) => {
      // A newer revision than we know about makes everything older stale.
      if (r.revision > this.revision) {
        this.invalidate(r.revision);
      }
      if (r.revision >= this.revision) {
        this.chunks.set(base, { revision: r.revision, items: r.items });
      }
      this.total = r.total;
    }).finally(() => { this.inflight.delete(base); });
    this.inflight.set(base, p);
    return p;
  }
}

export interface LibraryWindowView {
  readonly cache: WindowCache;
  /** bumps whenever cached rows may have changed: components read it to re-render */
  version: Accessor<number>;
  total: Accessor<number>;
  /** call from the virtualiser with the visible range; fetches visible +- 1 screen */
  ensureVisible(start: number, end: number): Promise<void>;
  dispose(): void;
}

export function createLibraryStore(client: CoreClient) {
  const [counts, setCounts] = createSignal<LibraryCounts | null>(null);
  const [revision, setRevision] = createSignal(0);
  const views = new Set<{ list: LocalList; cache: WindowCache; refetch: () => void }>();

  const unsub = client.sub("library", (ev, p) => {
    if (ev === "library.snapshot") {
      setCounts(p.counts);
      setRevision(p.revision);
      for (const v of views) v.refetch();
    } else if (ev === "library.changed") {
      setRevision(p.revision);
      void client.call("library.counts").then(setCounts).catch(() => {});
      const lists: LocalList[] = p.lists;
      for (const v of views) if (lists.includes(v.list)) v.refetch();
    }
  });

  /** Create a cached window over one list. Visible chunks are refetched on `library.changed`. */
  function window(list: LocalList, sort: SortSpec, filter?: FilterSpec): LibraryWindowView {
    const [version, setVersion] = createSignal(0);
    const [total, setTotal] = createSignal(0);
    let lastRange: [number, number] = [0, CHUNK];
    const cache = new WindowCache<LibraryItem>(async (offset, limit) => {
      const r = await client.call("library.window", { list, sort, filter, offset, limit });
      return r;
    });
    const view = {
      list, cache,
      refetch() {
        const rev = revision();
        cache.invalidate(rev);
        const [s, e] = lastRange;
        void cache.ensure(s, e).then(() => { setTotal(cache.total); setVersion((v) => v + 1); }).catch(() => {});
      },
    };
    views.add(view);
    return {
      cache, version, total,
      async ensureVisible(start, end) {
        lastRange = [start, end];
        await cache.ensure(start, end);
        if (cache.total !== total()) setTotal(cache.total);
        setVersion((v) => v + 1);
      },
      dispose() { views.delete(view); cache.clear(); },
    };
  }

  return { counts, revision, window, dispose: unsub };
}

export type LibraryStore = ReturnType<typeof createLibraryStore>;
