import { createSignal, type Accessor, type Setter } from "solid-js";
import { client } from "../lib/core";
import type { Track, WindowResult, SortSpec } from "../lib/types";

export const CHUNK = 100;

/** Chunked window cache for library.window (api.md 1.8B): chunks of 100 aligned to multiples of 100, dropped on a newer revision. */
export function createWindowStore(list: string, sort: SortSpec) {
  const chunks = new Map<number, [Accessor<Track[] | undefined>, Setter<Track[] | undefined>]>();
  const inflight = new Set<number>();
  const [total, setTotal] = createSignal(0);
  let revision = 0;

  const slot = (c: number) => {
    let s = chunks.get(c);
    if (!s) chunks.set(c, (s = createSignal<Track[] | undefined>(undefined)));
    return s;
  };
  const fetchChunk = (c: number) => {
    if (inflight.has(c)) return;
    inflight.add(c);
    client
      .call<WindowResult<Track>>("library.window", { list, sort, offset: c * CHUNK, limit: CHUNK })
      .then((r) => {
        if (r.revision < revision) return; // stale
        revision = r.revision;
        setTotal(r.total);
        slot(c)[1](r.items);
      })
      .finally(() => inflight.delete(c));
  };
  return {
    total,
    track(i: number): Track | undefined {
      return slot(Math.floor(i / CHUNK))[0]()?.[i % CHUNK];
    },
    /** request every chunk touching [start, end) that is neither loaded nor loading */
    ensure(start: number, end: number) {
      for (let c = Math.floor(start / CHUNK); c <= Math.floor(Math.max(start, end - 1) / CHUNK); c++) {
        if (slot(c)[0]() === undefined) fetchChunk(c);
      }
    },
    /** library.changed {revision}: drop cached chunks with an older revision and refetch the visible ones */
    invalidate(rev: number, visible: [number, number]) {
      if (rev <= revision) return;
      revision = rev;
      chunks.forEach(([, set]) => set(undefined));
      this.ensure(visible[0], visible[1]);
    },
  };
}
