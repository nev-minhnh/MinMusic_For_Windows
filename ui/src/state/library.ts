import { createSignal, getOwner, onCleanup, type Accessor, type Setter } from "solid-js";
import { client } from "../lib/core";
import type { Track, WindowResult, SortSpec, FilterSpec, LocalList, LibraryCounts } from "../lib/types";

export const CHUNK = 100;

// ---- one `library` topic subscription for the whole app, fanned out to listeners
type Listener = (name: string, data: any) => void;
const listeners = new Set<Listener>();
let subscribed = false;
function ensureSub() {
  if (subscribed) return;
  subscribed = true;
  client.sub("library", {}, (name, data) => {
    if (name === "library.snapshot") setCounts(data.counts);
    else if (name === "library.changed") refreshCounts();
    listeners.forEach((l) => l(name, data));
  });
}
/** Listen to `library` topic events (library.changed, userAlbums.changed, snapshot). Returns the unsubscribe. */
export function onLibraryEvent(cb: Listener): () => void {
  ensureSub();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ---- counts for the sidebar (library.counts + topic)
const [counts, setCounts] = createSignal<LibraryCounts | null>(null);
export { counts as libraryCounts };
let countsT = 0;
function refreshCounts() {
  clearTimeout(countsT);
  countsT = window.setTimeout(() => {
    client.call<LibraryCounts>("library.counts").then(setCounts).catch(() => {});
  }, 120);
}
export function initLibrary() {
  ensureSub();
  refreshCounts();
}

/**
 * Chunked window cache for library.window (api.md 1.8B) over any LocalList (songs, liked, history, `userAlbum:<id>`, ...):
 * chunks of 100 aligned to multiples of 100. A `library.changed` with a newer revision drops the stale chunks
 * (visible ones are refetched in place, so rows do not flash); chunk replies with an older revision are ignored.
 */
export function createWindowStore<T = Track>(list: LocalList, sort0: SortSpec, filter0?: FilterSpec) {
  const chunks = new Map<number, [Accessor<T[] | undefined>, Setter<T[] | undefined>]>();
  const inflight = new Set<number>();
  const [total, setTotal] = createSignal(0);
  const [sort, setSortSig] = createSignal(sort0);
  const [filter, setFilterSig] = createSignal(filter0);
  let revision = 0;
  let epoch = 0; // bumped when sort/filter change, so replies for the old query are dropped
  let range: [number, number] = [0, CHUNK];

  const slot = (c: number) => {
    let s = chunks.get(c);
    if (!s) chunks.set(c, (s = createSignal<T[] | undefined>(undefined)));
    return s;
  };
  const fetchChunk = (c: number) => {
    if (inflight.has(c)) return;
    inflight.add(c);
    const e = epoch;
    client
      .call<WindowResult<T>>("library.window", { list, sort: sort(), filter: filter(), offset: c * CHUNK, limit: CHUNK })
      .then((r) => {
        if (e !== epoch || r.revision < revision) return; // stale
        revision = r.revision;
        setTotal(r.total);
        slot(c)[1](() => r.items);
      })
      .catch(() => {})
      .finally(() => inflight.delete(c));
  };
  const chunksOf = (start: number, end: number) => {
    const out: number[] = [];
    for (let c = Math.floor(start / CHUNK); c <= Math.floor(Math.max(start, end - 1) / CHUNK); c++) out.push(c);
    return out;
  };
  const reset = () => {
    epoch++;
    inflight.clear();
    chunks.forEach(([, set]) => set(undefined));
    chunksOf(range[0], range[1]).forEach(fetchChunk);
  };

  const store = {
    total,
    sort,
    filter,
    track(i: number): T | undefined {
      return slot(Math.floor(i / CHUNK))[0]()?.[i % CHUNK];
    },
    /** request every chunk touching [start, end) that is neither loaded nor loading */
    ensure(start: number, end: number) {
      range = [start, end];
      for (const c of chunksOf(start, end)) if (slot(c)[0]() === undefined) fetchChunk(c);
    },
    /** library.changed {revision}: refetch the visible chunks in place, drop the rest */
    invalidate(rev: number, visible: [number, number] = range) {
      if (rev <= revision) return;
      revision = rev;
      epoch++;
      inflight.clear();
      range = visible;
      const vis = new Set(chunksOf(visible[0], visible[1]));
      chunks.forEach(([, set], c) => {
        if (!vis.has(c)) set(undefined);
      });
      vis.forEach(fetchChunk);
    },
    setSort(s: SortSpec) {
      setSortSig(s);
      reset();
    },
    setFilter(f: FilterSpec | undefined) {
      setFilterSig(f);
      reset();
    },
    /** position of a track in this list (scroll-to-playing); -1 when it is not in the list */
    async indexOf(id: string): Promise<number> {
      try {
        return (await client.call<{ index: number }>("library.indexOf", { list, sort: sort(), filter: filter(), id })).index;
      } catch {
        return -1;
      }
    },
    dispose() {
      off();
    },
  };
  const off = onLibraryEvent((name, d) => {
    if (name === "library.changed" && (!d.lists?.length || d.lists.includes(list))) store.invalidate(d.revision);
  });
  if (getOwner()) onCleanup(off);
  return store;
}
