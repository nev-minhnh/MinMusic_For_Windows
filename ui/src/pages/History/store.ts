import { createSignal, getOwner, onCleanup, type Accessor, type Setter } from "solid-js";
import { client } from "../../lib/core";
import { CHUNK, onLibraryEvent } from "../../state/library";
import { normalizeGroups, type Group } from "./flat";
import type { Track } from "../../lib/types";

export type HistoryRow = Track & { playedAt: number; eventId?: string };
type Result = { total: number; revision: number; offset: number; items: HistoryRow[]; groups?: Group[] };

const SORT = { by: "lastPlayed", desc: true } as const;

/**
 * `history.window` in chunks of 100 (like createWindowStore) plus the group list of the reply. The core sends the groups of the whole
 * list; replies are merged by offset, so a core that sends only the groups of a chunk still ends up with the full set.
 */
export function createHistoryStore() {
  const chunks = new Map<number, [Accessor<HistoryRow[] | undefined>, Setter<HistoryRow[] | undefined>]>();
  const inflight = new Set<number>();
  const [total, setTotal] = createSignal(0);
  const [groups, setGroups] = createSignal<Group[]>([]);
  let known: Group[] = [];
  let revision = 0;
  let epoch = 0;
  let range: [number, number] = [0, CHUNK];

  const slot = (c: number) => {
    let s = chunks.get(c);
    if (!s) chunks.set(c, (s = createSignal<HistoryRow[] | undefined>(undefined)));
    return s;
  };
  const fetchChunk = (c: number) => {
    if (inflight.has(c)) return;
    inflight.add(c);
    const e = epoch;
    client
      .call<Result>("history.window", { list: "history", sort: SORT, offset: c * CHUNK, limit: CHUNK })
      .then((r) => {
        if (e !== epoch || r.revision < revision) return;
        revision = r.revision;
        known = [...known.filter((g) => !r.groups?.some((n) => n.offset === g.offset)), ...(r.groups ?? [])];
        setTotal(r.total);
        setGroups(normalizeGroups(known, r.total));
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

  const store = {
    total,
    groups,
    track: (i: number): HistoryRow | undefined => slot(Math.floor(i / CHUNK))[0]()?.[i % CHUNK],
    ensure(start: number, end: number) {
      range = [start, end];
      for (const c of chunksOf(start, end)) if (slot(c)[0]() === undefined) fetchChunk(c);
    },
    /** a newer library revision: drop what is not visible, refetch what is (rows stay until the reply arrives) */
    invalidate(rev: number) {
      if (rev <= revision) return;
      revision = rev;
      epoch++;
      inflight.clear();
      known = [];
      const vis = new Set(chunksOf(range[0], range[1]));
      chunks.forEach(([, set], c) => {
        if (!vis.has(c)) set(undefined);
      });
      vis.forEach(fetchChunk);
    },
    /** F5 */
    reload() {
      epoch++;
      inflight.clear();
      known = [];
      chunksOf(range[0], range[1]).forEach(fetchChunk);
    },
  };
  const off = onLibraryEvent((name, d) => {
    if (name === "library.changed" && (!d.lists?.length || d.lists.includes("history"))) store.invalidate(d.revision);
  });
  if (getOwner()) onCleanup(off);
  return store;
}
