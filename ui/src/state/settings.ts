// Settings store: the `settings` topic (snapshot, then {changed} deltas) + settings.schema.
// Writes are optimistic with rollback when the core refuses them (bad_request) or is unreachable.
// themeMode / appLanguage drive <html data-theme> and the i18n locale live.
import { createEffect, createRoot, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { SettingEntry } from "@minmusic/protocol";
import { client } from "../lib/core";
import { setAppLanguage } from "../i18n";

const [values, setValues] = createStore<Record<string, unknown>>({});
const [schema, setSchema] = createSignal<ReadonlyMap<string, SettingEntry>>(new Map());
const [gotValues, setGotValues] = createSignal(false);
const ready = () => gotValues() && schema().size > 0;
const [failed, setFailed] = createSignal<{ key: string; code?: string } | null>(null);

export { schema as settingsSchema, ready as settingsReady, failed as settingFailure };

export const entryOf = (key: string): SettingEntry | undefined => schema().get(key);
/** A key the desktop UI shows: known to the core and not Android-only. */
export const isDesktopKey = (key: string): boolean => {
  const e = schema().get(key);
  return !!e && e.platform !== "android";
};

/** Reactive value of a key: the live value, else the schema default. */
export function settingValue<T = unknown>(key: string): T | undefined {
  const v = values[key];
  return (v !== undefined ? v : schema().get(key)?.default) as T | undefined;
}
export const settingBool = (key: string): boolean => settingValue<boolean>(key) === true;

// ---- theme + language
/** `data-theme` for a themeMode: PURE_BLACK -> black, AUTO -> none (the stylesheet follows the system). */
export function themeAttr(mode: unknown): string | null {
  switch (mode) {
    case "LIGHT": return "light";
    case "PURE_BLACK": return "black";
    case "AUTO": return null;
    default: return "dark";
  }
}
export function applyTheme(mode: unknown, root: HTMLElement = document.documentElement) {
  const a = themeAttr(mode);
  if (a) root.dataset.theme = a;
  else delete root.dataset.theme;
}

let started = false;
const fromQuery = (k: string) => typeof location !== "undefined" && new URLSearchParams(location.search).has(k);

/** Idempotent. Called once when the app starts (input/commands/settings.ts). */
export function initSettings() {
  if (started) return;
  started = true;
  try {
    client.sub("settings", {}, (ev, data) => {
      if (ev === "settings.snapshot") setValues(data.values ?? {});
      else if (ev === "settings.changed") setValues(data.changed ?? {});
      setGotValues(true);
    });
    client.call<{ entries: SettingEntry[] }>("settings.schema").then((r) => setSchema(new Map(r.entries.map((e) => [e.key, e])))).catch(() => {});
  } catch {
    /* no core (offline stub): defaults only */
  }
  createRoot(() => {
    // ?theme= / ?lang= (tests, screenshots) win over the stored setting
    createEffect(() => {
      const m = values.themeMode;
      if (m !== undefined && !fromQuery("theme")) applyTheme(m);
    });
    createEffect(() => {
      const l = values.appLanguage;
      if (typeof l === "string" && !fromQuery("lang")) setAppLanguage(l);
    });
  });
}

/** Object values (secrets) are merged in place by the store, so the rollback copy must be a real copy. */
const snapshotOf = (v: unknown) => (v && typeof v === "object" ? { ...(v as object) } : v);

let failTimer = 0;
function flagFailure(key: string, e: unknown) {
  setFailed({ key, code: (e as { code?: string })?.code });
  clearTimeout(failTimer);
  failTimer = window.setTimeout(() => setFailed(null), 4000);
}

/** Optimistic write: the UI shows the new value at once; a refusal restores the previous one. */
export async function setSetting(key: string, value: unknown): Promise<boolean> {
  const prev = snapshotOf(values[key]);
  setValues(key, value);
  try {
    await client.call("settings.set", { values: { [key]: value } });
    return true;
  } catch (e) {
    setValues(key, prev);
    flagFailure(key, e);
    return false;
  }
}

/** Secrets never travel through settings.set: lyrics.ai.setKey (empty key clears it). */
export async function setSecret(key: string, provider: string, secret: string): Promise<boolean> {
  const prev = snapshotOf(values[key]);
  setValues(key, { set: secret !== "" });
  try {
    await client.call("lyrics.ai.setKey", { provider, key: secret });
    return true;
  } catch (e) {
    setValues(key, prev);
    flagFailure(key, e);
    return false;
  }
}

export async function resetSetting(key: string): Promise<void> {
  try {
    await client.call("settings.reset", { keys: [key] });
  } catch (e) {
    flagFailure(key, e);
  }
}

/** Test seam: replace the store content without a core. */
export function __seedSettings(entries: SettingEntry[], vals: Record<string, unknown> = {}) {
  setSchema(new Map(entries.map((e) => [e.key, e])));
  setValues(vals);
  setGotValues(true);
}
