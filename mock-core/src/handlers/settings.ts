// Mock of api.md 3.10: settings.schema / get / set / reset, the `settings` topic and the lyrics AI secret setters.
// The schema is mock-core/fixtures/settings/schema.json (generated from Settings.kt by scripts/gen-settings-schema.mjs).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SettingEntry } from "@minmusic/protocol";
import { FIXTURES, type HandlerModule, type MockState } from "../state.ts";
import { bad, isObj } from "../util.ts";

const entries = (JSON.parse(readFileSync(join(FIXTURES, "settings", "schema.json"), "utf8")) as { entries: SettingEntry[] }).entries;
const byKey = new Map(entries.map((e) => [e.key, e]));

type Store = Map<string, unknown>;
const stores = new WeakMap<MockState, Store>();
function store(st: MockState): Store {
  let s = stores.get(st);
  if (!s) stores.set(st, (s = new Map(entries.map((e) => [e.key, structuredClone(e.default)]))));
  return s;
}
/** Secrets are never sent back: `{set}` only. */
const wire = (e: SettingEntry, v: unknown) => (e.type === "secret" ? { set: !!(v as { set?: boolean })?.set } : v);
const snapshot = (st: MockState) => {
  const s = store(st);
  return Object.fromEntries(entries.map((e) => [e.key, wire(e, s.get(e.key))]));
};

/** Throws bad_request when `v` does not fit the entry (type, enum membership, min/max). */
export function validate(e: SettingEntry, v: unknown): void {
  const k = e.key;
  switch (e.type) {
    case "bool": if (typeof v !== "boolean") throw bad(`${k}: boolean required`); break;
    case "int": case "float": {
      if (typeof v !== "number" || !Number.isFinite(v)) throw bad(`${k}: number required`);
      if (e.type === "int" && !Number.isInteger(v)) throw bad(`${k}: integer required`);
      if (e.min !== undefined && v < e.min) throw bad(`${k}: below ${e.min}`);
      if (e.max !== undefined && v > e.max) throw bad(`${k}: above ${e.max}`);
      break;
    }
    case "string": if (typeof v !== "string") throw bad(`${k}: string required`); break;
    case "enum": if (typeof v !== "string" || !e.enumValues?.includes(v)) throw bad(`${k}: one of ${e.enumValues?.join("|")}`); break;
    case "json": break;
    case "secret": throw bad(`${k}: secret, use its dedicated method`);
  }
}

const aiKeyFor = (provider: unknown) => (String(provider ?? "").toLowerCase() === "deepl" ? "lyricsDeepLApiKey" : "lyricsAiApiKey");

export const handlers: HandlerModule["handlers"] = {
  "settings.schema": () => ({ entries }),
  "settings.get": (p, { st }) => {
    const s = store(st);
    const keys: string[] = p?.keys ?? entries.map((e) => e.key);
    if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string")) throw bad("keys: string[] required");
    const values: Record<string, unknown> = {};
    for (const k of keys) {
      const e = byKey.get(k);
      if (!e) throw bad(`unknown key ${k}`);
      values[k] = wire(e, s.get(k));
    }
    return { values };
  },
  "settings.set": (p, { st, emit }) => {
    if (!isObj(p?.values)) throw bad("values: object required");
    const s = store(st);
    const next: [SettingEntry, unknown][] = [];
    for (const [k, v] of Object.entries(p.values)) {
      const e = byKey.get(k);
      if (!e) throw bad(`unknown key ${k}`);
      validate(e, v);
      next.push([e, v]);
    }
    const changed: Record<string, unknown> = {};
    for (const [e, v] of next) if (JSON.stringify(s.get(e.key)) !== JSON.stringify(v)) { s.set(e.key, v); changed[e.key] = v; }
    if (Object.keys(changed).length) emit("settings", "settings.changed", { changed });
    return {};
  },
  "settings.reset": (p, { st, emit }) => {
    if (!Array.isArray(p?.keys)) throw bad("keys: string[] required");
    const s = store(st);
    const changed: Record<string, unknown> = {};
    for (const k of p.keys) {
      const e = byKey.get(k);
      if (!e) throw bad(`unknown key ${k}`);
      s.set(k, structuredClone(e.default));
      changed[k] = wire(e, e.default);
    }
    if (Object.keys(changed).length) emit("settings", "settings.changed", { changed });
    return {};
  },
  "lyrics.ai.setKey": (p, { st, emit }) => {
    if (typeof p?.provider !== "string" || p.provider === "") throw bad("provider: non-empty string required");
    if (typeof p?.key !== "string") throw bad("key: string required");
    const key = aiKeyFor(p.provider);
    store(st).set(key, { set: p.key !== "" });
    emit("settings", "settings.changed", { changed: { [key]: { set: p.key !== "" } } });
    return {};
  },
  "lyrics.ai.test": (p, { st }) => {
    const set = (store(st).get(aiKeyFor(p?.provider)) as { set?: boolean })?.set;
    return set ? { ok: true } : { ok: false, error: "no key" };
  },
};

export const topics: HandlerModule["topics"] = {
  settings: ({ st }) => ({ values: snapshot(st) }),
};
