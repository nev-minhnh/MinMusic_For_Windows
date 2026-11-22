import { createEffect, onCleanup, onMount } from "solid-js";
import type { CursorList } from "./cursorList";

/**
 * Pages a cursor list from a sentinel element below it: loads the first page on mount (unless the list already holds data),
 * the next one when the sentinel comes within 800 px of the viewport, and keeps asking while a page leaves the sentinel that near
 * (a short page does not move it across the IntersectionObserver boundary, so an observer alone would stall).
 */
export function useSentinelPaging(list: CursorList<unknown>, sentinel: () => HTMLElement) {
  onMount(() => {
    if (!list.items().length) void list.loadMore();
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void list.loadMore();
      },
      { rootMargin: "0px 0px 800px 0px" }
    );
    io.observe(sentinel());
    onCleanup(() => io.disconnect());
  });
  createEffect(() => {
    const n = list.items().length;
    if (n && !list.loading() && !list.error() && list.hasMore()) {
      requestAnimationFrame(() => {
        const el = sentinel();
        if (el && el.getBoundingClientRect().top < window.innerHeight + 800) void list.loadMore();
      });
    }
  });
}
