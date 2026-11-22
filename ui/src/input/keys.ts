import { back, forward, canBack } from "../router/router";
import { handleEsc } from "../lib/esc";
import { client } from "../lib/core";
import { dialogsOpen } from "../state/ui";
import { keyCtx, type Command } from "./ctx";

/** One shortcut of frontend-spec section 7. `key` is `KeyboardEvent.key` (lower-cased when it is a single character). */
export type KeySpec = { key: string; cmd: string; arg?: string; ctrl?: boolean; alt?: boolean; shift?: boolean; anyShift?: boolean };

const seek = (d: -1 | 1) => ({ cmd: "seek.rel", arg: String(d) });
export const KEYMAP: KeySpec[] = [
  { key: " ", cmd: "player.toggle" },
  { key: "ArrowLeft", ...seek(-1) }, { key: "ArrowRight", ...seek(1) },
  { key: "ArrowUp", cmd: "volume.rel", arg: "1" }, { key: "ArrowDown", cmd: "volume.rel", arg: "-1" },
  { key: "+", cmd: "volume.rel", arg: "1", anyShift: true }, { key: "=", cmd: "volume.rel", arg: "1", anyShift: true },
  { key: "-", cmd: "volume.rel", arg: "-1" }, { key: "_", cmd: "volume.rel", arg: "-1", anyShift: true },
  { key: "m", cmd: "player.mute" },
  ...Array.from({ length: 10 }, (_, i): KeySpec => ({ key: String(i), cmd: "seek.pct", arg: String(i * 10) })),
  { key: "ArrowRight", ctrl: true, cmd: "player.next" }, { key: "n", cmd: "player.next" },
  { key: "ArrowLeft", ctrl: true, cmd: "player.prev" }, { key: "p", cmd: "player.prev" },
  { key: "s", cmd: "player.shuffle" }, { key: "r", cmd: "player.repeat" },
  { key: "t", cmd: "fullPlayer.toggle" },
  { key: "l", cmd: "pane.lyrics" }, { key: "q", cmd: "pane.queue" }, { key: "d", cmd: "pane.deviceConnect" },
  { key: "c", cmd: "video.captions" }, { key: "v", cmd: "video.mode" }, { key: "f", cmd: "window.fullscreen" },
  { key: "k", ctrl: true, cmd: "search.focus" }, { key: "f", ctrl: true, cmd: "search.focus" }, { key: "/", cmd: "search.focus", anyShift: true },
  { key: ",", ctrl: true, cmd: "settings.open" },
  { key: "`", ctrl: true, cmd: "shortcuts.sheet" }, { key: "/", ctrl: true, cmd: "shortcuts.sheet", anyShift: true },
  { key: "l", ctrl: true, shift: true, cmd: "logs.open" },
  { key: "m", ctrl: true, cmd: "mini.open" },
  { key: "b", ctrl: true, cmd: "sidebar.toggle" },
  { key: "e", ctrl: true, cmd: "equalizer.open" },
  { key: "F11", cmd: "fullscreen.toggle" },
  { key: "F5", cmd: "page.refresh" },
  { key: "l", ctrl: true, cmd: "track.like" },
  { key: "i", ctrl: true, cmd: "track.info" },
  { key: "c", ctrl: true, cmd: "link.copy" },
  { key: "Delete", cmd: "page.delete" }, { key: "F2", cmd: "page.rename" },
  { key: "q", ctrl: true, cmd: "app.quit" },
  { key: "ArrowLeft", alt: true, cmd: "nav.back" }, { key: "ArrowRight", alt: true, cmd: "nav.forward" },
];

export type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;
const norm = (k: string) => (k.length === 1 ? k.toLowerCase() : k);

/** The command a key press maps to, or null. Pure: tested without a DOM. */
export function commandFor(e: KeyLike): { cmd: string; arg?: string; plain: boolean } | null {
  const k = norm(e.key);
  const ctrl = e.ctrlKey || e.metaKey;
  for (const s of KEYMAP) {
    if (norm(s.key) !== k || !!s.ctrl !== ctrl || !!s.alt !== e.altKey) continue;
    if (!s.anyShift && !!s.shift !== e.shiftKey) continue;
    return { cmd: s.cmd, arg: s.arg, plain: !s.ctrl && !s.alt };
  }
  return null;
}

// ---- command registry: input/commands/<area>.ts, each exporting `commands`
const registry = new Map<string, Command["run"]>();
for (const m of Object.values(import.meta.glob<{ commands?: Command[] }>("./commands/*.ts", { eager: true }))) {
  for (const c of m.commands ?? []) registry.set((c.id ?? c.key)!, c.run);
}
export const hasCommand = (id: string) => registry.has(id);

const missingLogged = new Set<string>();
/** Runs a command id. An id nobody registered is logged once and ignored. */
export function runCommand(id: string, arg?: string, event?: KeyboardEvent) {
  const run = registry.get(id);
  if (run) return run({ arg, event });
  if (missingLogged.has(id)) return;
  missingLogged.add(id);
  console.warn(`keys: no command "${id}"`);
  client.call("app.log", { level: "warn", msg: `keys: missing command ${id}` }).catch(() => {});
}

export const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/** Global shortcuts (frontend-spec section 7). Plain keys are ignored while typing or while a dialog is open. Backspace never navigates. */
export function initKeys(focusSearch: () => void) {
  keyCtx.focusSearch = focusSearch;
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (e.defaultPrevented) return;
      if (!handleEsc() && !isTyping(e.target) && !dialogsOpen() && canBack()) back();
      return;
    }
    if (e.defaultPrevented) return; // a menu or list already took the key
    const hit = commandFor(e);
    if (!hit) return;
    const typing = isTyping(e.target);
    if (dialogsOpen()) return;
    if (typing && (hit.plain || hit.cmd === "link.copy" || hit.cmd === "track.like")) return;
    if (hit.cmd === "player.toggle" && e.repeat) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    runCommand(hit.cmd, hit.arg, e);
  });
  // Space on a focused button would click it on keyup; the global handler already took the key.
  window.addEventListener("keyup", (e) => {
    if ((e.key === " " || e.code === "Space") && !isTyping(e.target) && !dialogsOpen()) e.preventDefault();
  });
  // mouse XButton1 / XButton2
  const mouse = (e: MouseEvent) => {
    if (e.button === 3) {
      e.preventDefault();
      if (e.type === "mouseup") back();
    } else if (e.button === 4) {
      e.preventDefault();
      if (e.type === "mouseup") forward();
    }
  };
  window.addEventListener("mouseup", mouse);
  window.addEventListener("auxclick", (e) => (e.button === 3 || e.button === 4) && e.preventDefault());
}
