// Drag reorder of the songs table of a user album (M1-3a dnd: payload.from === "userAlbum:<id>", live drag in lib/dnd).
import { onCleanup } from "solid-js";
import { client } from "../../lib/core";
import { onLibraryEvent } from "../../state/library";
import { currentDrag, gapIndex, isTrackDrag, moveTarget } from "../../lib/dnd";
import { HEAD_H, ROW_H } from "../../components/Table";

/**
 * Where a drop at pointer offset `y` (px below the first row) puts the dragged row: the gap between rows nearest to `y`
 * and the index the row has once it has left its old place (`userAlbum.move {from, to}` means "remove at from, insert at to").
 */
export function reorderIndex(from: number, y: number, total: number, rowH = ROW_H): { gap: number; to: number } {
  const gap = gapIndex(y, rowH, total);
  return { gap, to: moveTarget(from, gap) };
}

/** The error code of a rejected call (RpcError carries it as `code`). */
export const errorCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

/**
 * The library revision this page has seen, for `userAlbum.move {expectedRevision}`. Starts from a 1-row `library.window`,
 * follows `library.changed`, and is re-read after every move of our own (the core bumps the revision on every write).
 */
export function createRevision(list: string) {
  let rev = 0;
  const read = () =>
    client
      .call<{ revision: number }>("library.window", { list, sort: { by: "custom", desc: false }, offset: 0, limit: 1 })
      .then((r) => void (rev = r.revision))
      .catch(() => {});
  let ready = read();
  const off = onLibraryEvent((name, d) => {
    if (name === "library.changed" && typeof d?.revision === "number") rev = Math.max(rev, d.revision);
  });
  onCleanup(off);
  return {
    get: async () => (await ready, rev),
    /** call after our own write; the next `get` waits for it */
    sync: () => (ready = read()),
  };
}

/**
 * Makes the table a reorder target: a 2 px accent drop line (placed with `transform`, inside the page scroller) while a drag that started in
 * this user album is over it, and `onReorder(from, to)` on drop. A multi-row drag moves its first row. Returns the disposer.
 */
export function attachReorder(table: HTMLElement, page: HTMLElement, opts: { list: string; total: () => number; onReorder: (from: number, to: number) => void }): () => void {
  const line = document.createElement("div");
  line.className = "ua-line";
  line.dataset.testid = "ua-drop-line";
  page.appendChild(line);
  // lib/dnd clears its live drag in a capture listener on `drop` (a microtask that runs before ours), so the drag is kept from `dragover`
  let armed: ReturnType<typeof currentDrag> = null;
  const mine = () => {
    const d = currentDrag() ?? armed;
    return d?.payload.from === opts.list && d.indices.length > 0;
  };
  const rowsTop = () => table.getBoundingClientRect().top + HEAD_H;
  const at = (e: DragEvent) => reorderIndex((armed ?? currentDrag())!.indices[0], e.clientY - rowsTop(), opts.total());
  const hide = () => {
    line.classList.remove("on");
    armed = null;
  };
  const dragover = (e: DragEvent) => {
    if (!isTrackDrag(e) || !mine()) return;
    armed = currentDrag() ?? armed;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const p = page.getBoundingClientRect();
    const t = table.getBoundingClientRect();
    const y = rowsTop() + at(e).gap * ROW_H - p.top + page.scrollTop - 1;
    line.style.width = `${t.width}px`;
    line.style.transform = `translate(${t.left - p.left}px, ${y}px)`;
    line.classList.add("on");
  };
  const leave = (e: DragEvent) => {
    if (!table.contains(e.relatedTarget as Node | null)) hide();
  };
  const drop = (e: DragEvent) => {
    if (!isTrackDrag(e) || !mine()) return hide();
    e.preventDefault();
    e.stopPropagation();
    const from = (armed ?? currentDrag())!.indices[0];
    const { to } = at(e);
    hide();
    if (to !== from) opts.onReorder(from, to);
  };
  table.addEventListener("dragover", dragover);
  table.addEventListener("dragleave", leave);
  table.addEventListener("drop", drop);
  window.addEventListener("dragend", hide);
  return () => {
    table.removeEventListener("dragover", dragover);
    table.removeEventListener("dragleave", leave);
    table.removeEventListener("drop", drop);
    window.removeEventListener("dragend", hide);
    line.remove();
  };
}
