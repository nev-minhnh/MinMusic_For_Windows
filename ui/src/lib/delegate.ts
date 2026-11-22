import { startDrag } from "./dnd";

/** A context event that can come from the mouse or from Shift F10 / the Menu key (then `keyboard` is true and x/y is the row). */
export type CtxEvent = { clientX: number; clientY: number; target: EventTarget | null; keyboard: boolean };
export type SelectEvent = Pick<PointerEvent, "ctrlKey" | "metaKey" | "shiftKey" | "target">;
export type RowHandlers = {
  /** "down" on pointerdown, "click" after a click that was not a drag */
  onSelect?: (e: SelectEvent, phase: "down" | "click") => void;
  onContext?: (e: CtxEvent) => void;
  dragIds?: () => { ids: string[]; from?: string; indices?: number[] } | null;
  /** a click on a `data-act` button inside the row (like, more); `rect` is the button */
  onAct?: (act: string, rect: DOMRect) => void;
};

// Rows register their (lazy) handlers here; the list container resolves the row through data-key. No per-row listeners.
const reg = new WeakMap<Element, () => RowHandlers>();
export const registerRow = (el: Element, h: () => RowHandlers) => void reg.set(el, h);

const rowOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-key]") : null);
const interactive = (t: EventTarget | null) => t instanceof Element && !!t.closest("button,a,input,select,textarea,.lnk");

/**
 * One pointerdown / click / contextmenu / dragstart / keydown listener per list. Returns the disposer.
 * Rows (Row, Card, Tile) opt in with data-key + registerRow.
 */
export function delegate(container: HTMLElement): () => void {
  const find = (t: EventTarget | null) => {
    const row = rowOf(t);
    return row && container.contains(row) ? { row, h: reg.get(row)?.() } : null;
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || interactive(e.target)) return;
    find(e.target)?.h?.onSelect?.(e, "down");
  };
  const click = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const act = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-act]") : null;
    if (act) {
      find(act)?.h?.onAct?.(act.dataset.act!, act.getBoundingClientRect());
      return;
    }
    if (interactive(e.target)) return;
    find(e.target)?.h?.onSelect?.(e, "click");
  };
  const ctx = (e: MouseEvent) => {
    const r = find(e.target);
    if (!r?.h?.onContext) return;
    e.preventDefault();
    r.h.onContext({ clientX: e.clientX, clientY: e.clientY, target: e.target, keyboard: false });
  };
  const key = (e: KeyboardEvent) => {
    if (!(e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))) return;
    const r = find(e.target);
    if (!r?.h?.onContext) return;
    e.preventDefault();
    e.stopPropagation();
    const b = r.row.getBoundingClientRect();
    r.h.onContext({ clientX: b.left + 24, clientY: b.top + b.height / 2, target: r.row, keyboard: true });
  };
  const drag = (e: DragEvent) => {
    const d = find(e.target)?.h?.dragIds?.();
    if (!d || !d.ids.length) return;
    startDrag(e, { ids: d.ids, from: d.from }, d.indices);
  };
  container.addEventListener("pointerdown", down);
  container.addEventListener("click", click);
  container.addEventListener("contextmenu", ctx);
  container.addEventListener("keydown", key);
  container.addEventListener("dragstart", drag);
  return () => {
    container.removeEventListener("pointerdown", down);
    container.removeEventListener("click", click);
    container.removeEventListener("contextmenu", ctx);
    container.removeEventListener("keydown", key);
    container.removeEventListener("dragstart", drag);
  };
}
