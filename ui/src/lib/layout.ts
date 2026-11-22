import { createSignal } from "solid-js";

export type WClass = "compact" | "medium" | "expanded";
export type HClass = "short" | "regular" | "tall";
export const HYST = 16;

export function plainW(w: number): WClass {
  return w < 840 ? "compact" : w < 1200 ? "medium" : "expanded";
}
export function plainH(h: number): HClass {
  return h < 760 ? "short" : h < 1000 ? "regular" : "tall";
}
const WRANK: Record<WClass, number> = { compact: 0, medium: 1, expanded: 2 };
const HRANK: Record<HClass, number> = { short: 0, regular: 1, tall: 2 };

/** Width class with a 16 px hysteresis band: the class only changes once the width is 16 px past the boundary. */
export function widthClass(w: number, prev?: WClass): WClass {
  const p = plainW(w);
  if (!prev || p === prev) return prev ?? p;
  // moving to a larger class: must be >= boundary + HYST; to a smaller class: < boundary - HYST
  if (WRANK[p] > WRANK[prev]) return plainW(w - HYST) === p ? p : prev;
  return plainW(w + HYST) === p ? p : prev;
}
export function heightClass(h: number, prev?: HClass): HClass {
  const p = plainH(h);
  if (!prev || p === prev) return prev ?? p;
  if (HRANK[p] > HRANK[prev]) return plainH(h - HYST) === p ? p : prev;
  return plainH(h + HYST) === p ? p : prev;
}

const [wClass, setW] = createSignal<WClass>(plainW(window.innerWidth));
const [hClass, setH] = createSignal<HClass>(plainH(window.innerHeight));
const [size, setSize] = createSignal({ w: window.innerWidth, h: window.innerHeight });
export { wClass, hClass, size };

let timer = 0;
/** Starts listening to resize. Hysteresis while the edge is dragged, exact class once the resize ends (debounced). */
export function initLayout(onSettled?: () => void) {
  const apply = () => {
    setW((p) => widthClass(window.innerWidth, p));
    setH((p) => heightClass(window.innerHeight, p));
  };
  const onResize = () => {
    apply();
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      setW(plainW(window.innerWidth));
      setH(plainH(window.innerHeight));
      setSize({ w: window.innerWidth, h: window.innerHeight });
      onSettled?.();
    }, 120);
  };
  window.addEventListener("resize", onResize, { passive: true });
  onSettled?.();
  return () => window.removeEventListener("resize", onResize);
}
