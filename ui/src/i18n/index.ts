import { createSignal } from "solid-js";
import en from "./en.json";
import vi from "./vi.json";

type Msg = string | Record<string, string>;
const tables: Record<string, Record<string, Msg>> = { en, vi };

function pickLocale(setting: string): string {
  const l = setting === "SYSTEM" ? navigator.language : setting;
  return l.toLowerCase().startsWith("vi") ? "vi" : "en";
}

const [locale, setLocaleSig] = createSignal(pickLocale("SYSTEM"));
export { locale };
/** appLanguage setting: "SYSTEM" or a locale tag. Reactive: strings reload in place. */
export function setAppLanguage(setting: string) {
  setLocaleSig(pickLocale(setting));
  document.documentElement.lang = locale();
}

function fmt(s: string, args: unknown[]): string {
  return args.length ? s.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? "")) : s;
}

export function t(key: string, ...args: unknown[]): string {
  const m = tables[locale()][key] ?? tables.en[key];
  if (typeof m === "string") return fmt(m, args);
  return key;
}

export function plural(key: string, n: number, ...args: unknown[]): string {
  const m = tables[locale()][key] ?? tables.en[key];
  if (m && typeof m === "object") {
    const q = new Intl.PluralRules(locale()).select(n);
    return fmt(m[q] ?? m.other ?? key, [n, ...args]);
  }
  return key;
}
