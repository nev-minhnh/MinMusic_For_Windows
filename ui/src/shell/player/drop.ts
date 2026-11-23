// Drop target for rows dragged from any page (M1-3a's drag payload: MIME application/x-mm-tracks = {ids, from?}).
// Uses M1-3a's `dnd.dropTarget(el, onDrop)` when lib/dnd.ts exists in the build, else the same contract natively.
export const TRACKS_MIME = "application/x-mm-tracks";
export const QUEUE_MIME = "application/x-mm-queue";

type DnD = { dropTarget?: (el: HTMLElement, onDrop: (p: any) => void) => (() => void) | void };
const lib = Object.values(import.meta.glob<DnD>("../../lib/dnd.ts", { eager: true }))[0] as DnD | undefined;

export function idsFromPayload(p: unknown): string[] {
  if (Array.isArray(p)) return p.filter((x): x is string => typeof x === "string");
  const ids = (p as { ids?: unknown } | null)?.ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

/** Calls `onIds(ids)` when tracks are dropped on `el`; `onHover(true|false)` while a track drag is over it. */
export function attachTrackDrop(el: HTMLElement, onIds: (ids: string[]) => void, onHover?: (over: boolean) => void): () => void {
  if (lib?.dropTarget) {
    const un = lib.dropTarget(el, (p) => { const ids = idsFromPayload(p); if (ids.length) onIds(ids); });
    return () => { if (typeof un === "function") un(); };
  }
  let depth = 0;
  const has = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes(TRACKS_MIME);
  const enter = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); if (depth++ === 0) onHover?.(true); };
  const over = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); e.dataTransfer!.dropEffect = "copy"; };
  const leave = (e: DragEvent) => { if (!has(e)) return; if (--depth <= 0) { depth = 0; onHover?.(false); } };
  const drop = (e: DragEvent) => {
    if (!has(e)) return;
    e.preventDefault();
    depth = 0;
    onHover?.(false);
    try { onIds(idsFromPayload(JSON.parse(e.dataTransfer!.getData(TRACKS_MIME)))); } catch { /* not ours */ }
  };
  el.addEventListener("dragenter", enter);
  el.addEventListener("dragover", over);
  el.addEventListener("dragleave", leave);
  el.addEventListener("drop", drop);
  return () => {
    el.removeEventListener("dragenter", enter);
    el.removeEventListener("dragover", over);
    el.removeEventListener("dragleave", leave);
    el.removeEventListener("drop", drop);
  };
}
