import { createSignal } from "solid-js";
import type { Track } from "../../lib/types";

export type QTrack = Track & { qid: string };
export const CHUNK = 100;

type Call = <T = any>(m: string, p?: any) => Promise<T>;

/**
 * Queue window cache (api.md 3.6 / 4). Items live in 100-aligned chunks fetched with `queue.window`; the visible range is
 * remembered, and every `queue.changed` with a new revision refetches the visible chunks (old rows stay on screen until
 * the new ones land, so nothing flashes). Pure of the DOM: `call` is injected for tests.
 */
export function createQueueModel(call: Call) {
  const [total, setTotal] = createSignal(0);
  const [revision, setRevision] = createSignal(0);
  const [currentIndex, setCurrentIndex] = createSignal(-1);
  const [tick, setTick] = createSignal(0);
  const chunks = new Map<number, QTrack[]>();
  const inflight = new Map<number, number>(); // chunk -> revision asked for
  let chunkRev = -1; // revision of the cached chunks
  let range: [number, number] = [0, 0];
  let wantRev = 0;

  const fetchChunk = (c: number) => {
    if (inflight.get(c) === wantRev) return;
    inflight.set(c, wantRev);
    call<{ total: number; revision: number; currentIndex: number; items: QTrack[] }>("queue.window", { offset: c * CHUNK, limit: CHUNK })
      .then((r) => {
        if (inflight.get(c) === wantRev) inflight.delete(c);
        if (r.revision < chunkRev) return; // an older answer than what is cached
        if (r.revision > chunkRev) {
          // newer content: the other cached chunks are stale; they are dropped once their replacement is requested
          for (const k of [...chunks.keys()]) if (k !== c) chunks.delete(k);
          chunkRev = r.revision;
        }
        chunks.set(c, r.items);
        setTotal(r.total);
        setRevision(r.revision);
        setCurrentIndex(r.currentIndex);
        wantRev = Math.max(wantRev, r.revision);
        setTick((n) => n + 1);
        // the content moved on while we were asking: ask again for what is on screen
        if (r.revision < wantRev) ensure();
        else ensureVisible(c);
      })
      .catch(() => { inflight.delete(c); });
  };
  /** after a chunk landed, make sure the other visible chunks belong to the same revision */
  const ensureVisible = (landed: number) => {
    for (const c of visibleChunks()) if (c !== landed && !chunks.has(c) && !inflight.has(c)) fetchChunk(c);
  };
  const visibleChunks = () => {
    const out: number[] = [];
    const [a, b] = range;
    if (b <= a) return out;
    for (let c = Math.floor(a / CHUNK); c <= Math.floor((b - 1) / CHUNK); c++) out.push(c);
    return out;
  };
  function ensure() {
    for (const c of visibleChunks()) if (!chunks.has(c) || chunkRev < wantRev) fetchChunk(c);
  }

  return {
    total, revision, currentIndex,
    /** reactive: reads `tick` so rows re-render when a chunk lands */
    item(i: number): QTrack | undefined {
      tick();
      return chunks.get(Math.floor(i / CHUNK))?.[i % CHUNK];
    },
    /** queue indexes [start, end) are on screen */
    setVisible(start: number, end: number) {
      range = [start, end];
      ensure();
    },
    onEvent(name: string, d: any) {
      if (name === "queue.snapshot") {
        setTotal(d.total);
        setCurrentIndex(d.currentIndex);
        setRevision(d.revision);
        wantRev = Math.max(wantRev, d.revision);
        if (d.revision !== chunkRev) {
          // the snapshot head primes the chunk when it covers it
          ensure();
        }
      } else if (name === "queue.changed") {
        setCurrentIndex(d.currentIndex);
        if (d.revision !== revision()) {
          setRevision(d.revision);
          wantRev = Math.max(wantRev, d.revision);
          ensure();
        }
      }
    },
    /** drop everything and refetch (reconnect, conflict) */
    refresh() {
      wantRev += 1;
      ensure();
    },
  };
}

