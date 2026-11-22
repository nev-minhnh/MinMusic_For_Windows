import { createSignal } from "solid-js";
import { setAppLanguage } from "../i18n";
import { devBuild } from "../lib/core";

export type Theme = "system" | "dark" | "black" | "light";
export type Lang = "SYSTEM" | "vi" | "en";
const THEMES: Theme[] = ["system", "dark", "black", "light"];
const LANGS: Lang[] = ["SYSTEM", "vi", "en"];

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage can be blocked */
  }
};

const pick = <T extends string>(v: string | null, all: T[], d: T): T => (all.includes(v as T) ? (v as T) : d);
const [theme, setThemeSig] = createSignal<Theme>(pick(read("mm.theme"), THEMES, "system"));
const [lang, setLangSig] = createSignal<Lang>(pick(read("mm.lang"), LANGS, "SYSTEM"));
export { theme, lang };

/** "system" removes the attribute, so tokens.css follows prefers-color-scheme */
export function applyTheme(t: Theme = theme()) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
/** Live switching (E-12): no reload. Persisted in localStorage until M4 binds it to settings.* */
export function setTheme(t: Theme) {
  setThemeSig(t);
  write("mm.theme", t);
  applyTheme(t);
}
export function setLang(l: Lang) {
  setLangSig(l);
  write("mm.lang", l);
  setAppLanguage(l);
}

/** Applies the stored prefs once. ?theme= and ?lang= in the URL win for this session without being stored (tests, screenshots). */
export function initPrefs() {
  const q = new URLSearchParams(location.search);
  const qt = q.get("theme");
  const ql = q.get("lang");
  if (qt && THEMES.includes(qt as Theme)) applyTheme(qt as Theme);
  else applyTheme();
  setAppLanguage(ql ?? lang());
  if (devBuild) (window as any).__mmPrefs = { theme, lang, setTheme, setLang };
}
