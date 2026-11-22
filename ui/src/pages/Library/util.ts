// Small helpers shared by the M1-3c pages (Library, Liked, Downloads, UserAlbum, History, Stats).
import { createEffect, on, onCleanup, type Accessor } from "solid-js";

/** Trailing debounce. `cancel()` drops a pending call. */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let id: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(id);
  return d;
}

/**
 * Page-level DOM events: Del, F2 and F5 arrive as `mm-delete`, `mm-rename` and `mm-refresh` on the page wrapper (the `[data-key]`
 * element of the route), dispatched by input/commands/m1.ts. Call from a component with the page's root element.
 */
export function onPageEvent(root: HTMLElement, name: "mm-delete" | "mm-rename" | "mm-refresh", fn: () => void) {
  const host = root.closest<HTMLElement>("[data-key]");
  if (!host) return;
  host.addEventListener(name, fn);
  onCleanup(() => host.removeEventListener(name, fn));
}

/** Number of columns of a card grid: floor((W + gap) / (card + gap)), at least 1 (MK 4). */
export function gridCols(width: number, card: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (card + gap)));
}

/** Pre-formatted time text for rows ("14:05", "12/11") from an epoch in ms. */
export function clockText(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(".", ",")} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(0, Math.round(n / 1e3))} KB`;
}

/**
 * Keep-alive pages hide with `content-visibility:hidden`, and Chromium then collapses the scroller's offset (a 5,000-row list comes
 * back about 1,000 px off). Remember the offset while the page is active and put it back when the page becomes active again.
 * The scroll listener is passive and writes nothing.
 */
export function keepScroll(root: HTMLElement, active: Accessor<boolean>) {
  const pg = root.closest<HTMLElement>(".pg");
  if (!pg) return;
  let top = pg.scrollTop;
  let settling = false; // Chromium's own (wrong) restore fires scroll events right after the page shows again: do not record them
  const onScroll = () => {
    if (active() && !settling) top = pg.scrollTop;
  };
  pg.addEventListener("scroll", onScroll, { passive: true });
  createEffect(
    on(
      active,
      (a) => {
        if (!a) return;
        settling = true;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (pg.scrollTop !== top) pg.scrollTop = top;
            setTimeout(() => (settling = false), 50);
          })
        );
      },
      { defer: true }
    )
  );
  onCleanup(() => pg.removeEventListener("scroll", onScroll));
}
