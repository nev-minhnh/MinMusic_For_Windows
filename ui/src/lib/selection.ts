import { createSignal, type Accessor } from "solid-js";
import { pushEsc } from "./esc";

export type ClickMods = { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };

export interface Selection {
  /** reactive: true when `key` is selected */
  has(key: string): boolean;
  /** selected keys in list order */
  keys(): string[];
  count: Accessor<number>;
  anchor(): string | undefined;
  /** click semantics: plain = select one, Ctrl = toggle, Shift = range from the anchor (Ctrl+Shift adds the range) */
  click(key: string, mods?: ClickMods): void;
  selectOnly(key: string): void;
  selectAll(): void;
  clear(): void;
  /** Ctrl A and Enter for a focused list. Returns true when it took the key. */
  onKeyDown(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean;
}

/**
 * Multi-selection over a list of string keys (frontend-spec 7: click, Ctrl+click, Shift+click, Ctrl A, Esc, Enter).
 * While non-empty the selection is one layer of the Esc stack. Pure signals, no effects: safe to create anywhere.
 */
export function createSelection(keys: () => string[], opts: { onPlay?: (keys: string[]) => void } = {}): Selection {
  const [set, setSet] = createSignal<ReadonlySet<string>>(new Set());
  let anchor: string | undefined;
  let popEsc: (() => void) | null = null;

  const commit = (next: Set<string>) => {
    setSet(next);
    if (next.size && !popEsc) popEsc = pushEsc(clear);
    else if (!next.size && popEsc) {
      popEsc();
      popEsc = null;
    }
  };
  function clear() {
    anchor = undefined;
    if (set().size) commit(new Set());
    else if (popEsc) {
      popEsc();
      popEsc = null;
    }
  }
  const selectOnly = (key: string) => {
    anchor = key;
    commit(new Set([key]));
  };
  const list = () => keys();

  const sel: Selection = {
    has: (key) => set().has(key),
    keys: () => list().filter((k) => set().has(k)),
    count: () => set().size,
    anchor: () => anchor,
    selectOnly,
    clear,
    selectAll() {
      const all = list();
      anchor = all[0];
      commit(new Set(all));
    },
    click(key, mods = {}) {
      const ctrl = !!(mods.ctrlKey || mods.metaKey);
      if (mods.shiftKey && anchor !== undefined) {
        const all = list();
        const a = all.indexOf(anchor);
        const b = all.indexOf(key);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const next = new Set(ctrl ? set() : []);
          for (let i = lo; i <= hi; i++) next.add(all[i]);
          commit(next); // the anchor stays, so the range can be re-extended
          return;
        }
      }
      if (ctrl) {
        const next = new Set(set());
        if (!next.delete(key)) next.add(key);
        anchor = key;
        commit(next);
        return;
      }
      selectOnly(key);
    },
    onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a") {
        sel.selectAll();
        return true;
      }
      if (e.key === "Enter" && !e.ctrlKey && !e.altKey && set().size && opts.onPlay) {
        opts.onPlay(sel.keys());
        return true;
      }
      return false;
    },
  };
  return sel;
}

// ---- the list that currently owns "the selection" for Ctrl C / Ctrl I (set by Table on focus)
export type ActiveList = { ids: () => string[]; kinds?: () => { id: string; kind: string }[] };
let active: ActiveList | null = null;
export const setActiveList = (l: ActiveList | null) => (active = l);
export const activeList = () => active;
