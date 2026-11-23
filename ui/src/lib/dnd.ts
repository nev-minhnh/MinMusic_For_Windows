import { createSignal } from "solid-js";
import { plural } from "../i18n";
import { client } from "./core";
import { inTauri } from "./tauri";
import { toast } from "../toast";

export const MIME = "application/x-mm-tracks";
/** `from` names the list the rows came from (e.g. "userAlbum:<id>"); pages that opt in to reorder compare it. */
export type DragPayload = { ids: string[]; from?: string };

// Dragging is in-process: browsers hide the payload during dragover, so the live drag is kept here as well.
let live: { payload: DragPayload; indices: number[] } | null = null;
const [count, setCount] = createSignal(0);
/** number of tracks being dragged right now (0 when none), for "Thả để thêm N bài" */
export const dragCount = count;
export const currentDrag = () => live;

let pill: HTMLElement | null = null;
function dragImage(n: number): HTMLElement {
  if (!pill) {
    pill = document.createElement("div");
    pill.className = "dnd-pill";
    document.body.appendChild(pill); // off-screen (position:fixed; left:-1000px), created once and reused
  }
  pill.textContent = plural("w2_n_songs", n);
  return pill;
}

/** dragstart for rows: payload `application/x-mm-tracks`, drag image = a pill "N bài hát". */
export function startDrag(e: DragEvent, payload: DragPayload, indices: number[] = []) {
  if (!e.dataTransfer || !payload.ids.length) return e.preventDefault();
  e.dataTransfer.setData(MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "copyMove";
  e.dataTransfer.setDragImage(dragImage(payload.ids.length), 12, 14);
  live = { payload, indices };
  setCount(payload.ids.length);
}
const endDrag = () => {
  live = null;
  setCount(0);
};
if (typeof window !== "undefined") {
  window.addEventListener("dragend", endDrag);
  // a macrotask: a microtask queued in a capture listener runs before the target's drop handlers and would clear `live` too early
  window.addEventListener("drop", () => setTimeout(endDrag, 0), true);
}

export const isTrackDrag = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes(MIME);
const parse = (e: DragEvent): DragPayload | null => {
  try {
    const p = JSON.parse(e.dataTransfer?.getData(MIME) ?? "") as DragPayload;
    return Array.isArray(p.ids) ? p : live?.payload ?? null;
  } catch {
    return live?.payload ?? null;
  }
};

/**
 * Makes `el` a drop target for dragged tracks (sidebar albums, player bar, queue button). While a drag is over it the class
 * `dnd-over` is set (CSS draws the accent ring through an overlay's opacity). Returns the disposer.
 */
export function dropTarget(el: HTMLElement, onDrop: (p: DragPayload) => void, opts: { accept?: () => boolean } = {}): () => void {
  const over = (e: DragEvent) => {
    if (!isTrackDrag(e) || (opts.accept && !opts.accept())) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    el.classList.add("dnd-over");
  };
  const leave = (e: DragEvent) => {
    if (!(e.relatedTarget instanceof Node) || !el.contains(e.relatedTarget)) el.classList.remove("dnd-over");
  };
  const drop = (e: DragEvent) => {
    el.classList.remove("dnd-over");
    if (!isTrackDrag(e) || (opts.accept && !opts.accept())) return;
    e.preventDefault();
    const p = parse(e);
    if (p) onDrop(p);
  };
  el.addEventListener("dragenter", over);
  el.addEventListener("dragover", over);
  el.addEventListener("dragleave", leave);
  el.addEventListener("drop", drop);
  return () => {
    el.removeEventListener("dragenter", over);
    el.removeEventListener("dragover", over);
    el.removeEventListener("dragleave", leave);
    el.removeEventListener("drop", drop);
    el.classList.remove("dnd-over");
  };
}

/** Where a drop at pointer offset `y` inside a list lands: the gap index 0..total (nearest row boundary). */
export const gapIndex = (y: number, rowH: number, total: number) => Math.max(0, Math.min(total, Math.round(y / rowH)));
/** Row `from` dropped into gap `gap` ends up at this index once it has been removed from its old place. */
export const moveTarget = (from: number, gap: number) => (gap > from ? gap - 1 : gap);

/**
 * Reorder inside one list (a user album): shows a 2 px accent drop line placed by `transform`, then calls onReorder(from, to).
 * `host` must be `position:relative` (VirtualList is). Only drags that started in `list` (payload.from) are accepted.
 * A multi-row drag moves its first row.
 */
export function reorderTarget(host: HTMLElement, opts: { list: string; rowH: number; total: () => number; onReorder: (from: number, to: number) => void }): () => void {
  const line = document.createElement("div");
  line.className = "dnd-line";
  host.appendChild(line);
  const mine = () => live?.payload.from === opts.list && live.indices.length > 0;
  const gapAt = (e: DragEvent) => gapIndex(e.clientY - host.getBoundingClientRect().top, opts.rowH, opts.total());
  const over = (e: DragEvent) => {
    if (!isTrackDrag(e) || !mine()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    line.style.transform = `translateY(${gapAt(e) * opts.rowH - 1}px)`;
    line.classList.add("on");
  };
  const hide = () => line.classList.remove("on");
  const leave = (e: DragEvent) => {
    if (!host.contains(e.relatedTarget as Node | null)) hide();
  };
  const drop = (e: DragEvent) => {
    hide();
    if (!isTrackDrag(e) || !mine()) return;
    e.preventDefault();
    e.stopPropagation();
    const from = live!.indices[0];
    const to = moveTarget(from, gapAt(e));
    if (to !== from) opts.onReorder(from, to);
  };
  host.addEventListener("dragover", over);
  host.addEventListener("dragleave", leave);
  host.addEventListener("drop", drop);
  host.addEventListener("dragend", hide);
  return () => {
    host.removeEventListener("dragover", over);
    host.removeEventListener("dragleave", leave);
    host.removeEventListener("drop", drop);
    host.removeEventListener("dragend", hide);
    line.remove();
  };
}

// ---- audio files dropped on the window (Tauri gives real paths through `tauri://drag-drop`; the web project ignores them)
export const AUDIO_EXT = ["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "wma", "aiff", "alac", "webm"];
export const audioPaths = (paths: string[]) => paths.filter((p) => AUDIO_EXT.includes(p.split(".").pop()?.toLowerCase() ?? ""));

export async function importPaths(paths: string[]): Promise<void> {
  const audio = audioPaths(paths);
  if (!audio.length) return;
  try {
    const r = await client.call<{ imported: number; failed: number }>("import.files", { paths: audio });
    toast({ i18n: "w2_import_done", args: [r.imported, r.failed] });
  } catch {
    toast({ i18n: "w2_error_generic", level: "error" });
  }
}

export function initFileDrop(): void {
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  // keep the browser from navigating to a dropped file
  window.addEventListener("dragover", (e) => hasFiles(e) && e.preventDefault());
  window.addEventListener("drop", (e) => hasFiles(e) && e.preventDefault());
  if (inTauri) {
    import("@tauri-apps/api/event").then(({ listen }) => listen<{ paths: string[] }>("tauri://drag-drop", (ev) => void importPaths(ev.payload.paths))).catch(() => {});
  }
}
