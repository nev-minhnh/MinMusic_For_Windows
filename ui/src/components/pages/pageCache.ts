import { createEffect, createSignal, on, type Accessor } from "solid-js";

/**
 * Page store (P3: Home -> Album -> Artist -> back x2 must be instant and refetch nothing).
 * Keep-alive keeps the last 5 routes mounted; this LRU keeps the data of the older ones, so a page that is mounted again
 * (after eviction) shows its data at once instead of calling the core again.
 */
const MAX = 40;
const store = new Map<string, unknown>();

export function cacheGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}
export function cacheSet<T>(key: string, v: T): void {
  store.delete(key);
  store.set(key, v);
  if (store.size > MAX) store.delete(store.keys().next().value as string);
}
export function cacheDrop(key: string): void {
  store.delete(key);
}
export function cacheClear(): void {
  store.clear();
}

export type PageData<T> = {
  data: Accessor<T | undefined>;
  error: Accessor<unknown>;
  /** replace the stored value (optimistic toggles: saved, subscribed) */
  mutate: (f: (v: T) => T) => void;
  reload: () => Promise<void>;
};

/** One value per key, fetched once and kept in the page store. `fetcher` is only called when the key has no stored value. */
export function createPageData<T>(key: () => string, fetcher: () => Promise<T>): PageData<T> {
  const [data, setData] = createSignal<T | undefined>(cacheGet<T>(key()));
  const [error, setError] = createSignal<unknown>();
  let gen = 0;
  const run = async () => {
    const k = key();
    const my = ++gen;
    try {
      const v = await fetcher();
      cacheSet(k, v);
      if (my === gen) setData(() => v);
    } catch (e) {
      if (my === gen) setError(e);
    }
  };
  createEffect(
    on(key, (k) => {
      setError(undefined);
      const hit = cacheGet<T>(k);
      setData(() => hit);
      if (hit === undefined) void run();
    })
  );
  return {
    data,
    error,
    mutate: (f) => {
      const cur = data();
      if (cur === undefined) return;
      const next = f(cur);
      cacheSet(key(), next);
      setData(() => next);
    },
    reload: run,
  };
}
