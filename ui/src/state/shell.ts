import { createSignal } from "solid-js";
import { invoke, inTauri } from "../lib/tauri";
import { wClass } from "../lib/layout";
import { pushEsc } from "../lib/esc";

export const SB_MIN = 216;
export const SB_MAX = 320;
export const SB_DEFAULT = 256;
export const clampSidebar = (w: number) => Math.max(SB_MIN, Math.min(SB_MAX, Math.round(w)));

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const put = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

const [width, setWidthSig] = createSignal(clampSidebar(Number(get("mm.sidebarWidth")) || SB_DEFAULT));
const [docked, setDockedSig] = createSignal(get("mm.sidebarDocked") !== "0");
const [overlay, setOverlaySig] = createSignal(false);
export { width as sidebarWidth, docked as sidebarDocked, overlay as overlayOpen };

/** Live width while dragging (not persisted yet). */
export const setSidebarWidthLive = (w: number) => setWidthSig(clampSidebar(w));
/** Persist: the shell command shell_settings_set {sidebarWidth} (M1-4), localStorage outside Tauri. */
export function persistSidebarWidth() {
  put("mm.sidebarWidth", String(width()));
  if (inTauri) void invoke("shell_settings_set", { sidebarWidth: width() });
}
export function setDocked(on: boolean) {
  setDockedSig(on);
  put("mm.sidebarDocked", on ? "1" : "0");
  if (inTauri) void invoke("shell_settings_set", { sidebarDocked: on });
}

let popEsc: (() => void) | null = null;
export function setOverlay(on: boolean) {
  if (on === overlay()) return;
  setOverlaySig(on);
  if (on) popEsc = pushEsc(() => setOverlay(false));
  else {
    popEsc?.();
    popEsc = null;
  }
}

/** Ctrl B: expanded docks or undocks (rail 80), medium and compact toggle the overlay sidebar. */
export function toggleSidebar() {
  if (wClass() === "expanded") setDocked(!docked());
  else setOverlay(!overlay());
}
