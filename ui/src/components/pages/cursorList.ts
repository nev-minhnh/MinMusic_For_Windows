import { createSignal, type Accessor } from "solid-js";
import { cacheGet, cacheSet } from "./pageCache";

export type CursorPage<T> = { items: T[]; next: string | null | undefined };
export type CursorList<T> = {
  items: Accessor<T[]>;
  hasMore: Accessor<boolean>;
  loading: Accessor<boolean>;
  error: Accessor<unknown>;
  /** loads the next page (the first one when nothing is loaded yet). Calls while one is in flight are ignored. */
  loadMore: () => Promise<void>;
  /** drops everything and loads the first page again */
  reset: () => Promise<void>;
};

/**
 * Cursor-paged list store (playlist.get, artist.tracks, podcast.episodes). Pages are appended in order and a page
 * is never requested twice. With `cacheKey` the loaded pages survive in the page store (no refetch when the page mounts again).
 */
export function createCursorList<T>(load: (cursor?: string) => Promise<CursorPage<T>>, cacheKey?: string): CursorList<T> {
  const hit = cacheKey ? cacheGet<{ items: T[]; next: string | null }>(cacheKey) : undefined;
  const [items, setItems] = createSignal<T[]>(hit?.items ?? []);
  const [next, setNext] = createSignal<string | null>(hit ? hit.next : null);
  const [started, setStarted] = createSignal(!!hit);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<unknown>();
  let busy = false;
  let gen = 0;

  const loadMore = async () => {
    if (busy || (started() && !next())) return;
    busy = true;
    setLoading(true);
    const my = gen;
    try {
      const p = await load(started() ? next() ?? undefined : undefined);
      if (my !== gen) return;
      const all = [...items(), ...p.items];
      setItems(all);
      setNext(p.next ?? null);
      setStarted(true);
      setError(undefined);
      if (cacheKey) cacheSet(cacheKey, { items: all, next: p.next ?? null });
    } catch (e) {
      if (my === gen) setError(e);
    } finally {
      busy = false;
      setLoading(false);
    }
  };
  const reset = async () => {
    gen++;
    busy = false;
    setItems([]);
    setNext(null);
    setStarted(false);
    await loadMore();
  };
  return { items, hasMore: () => !started() || !!next(), loading, error, loadMore, reset };
}
