// M4-1b settings contract (api.md 3.10): schema shape, get/set/reset, validation, secrets, the `settings` topic.
// Runs on the mock now; M4-1a must pass the same suite on the real core.
import assert from "node:assert/strict";
import { Conn } from "../lib/conn.mjs";

async function ui(ctx) {
  const c = await Conn.connect(ctx);
  ctx.cleanup.push(() => c.close());
  return c;
}
const code = async (c, m, p) => (await c.raw(m, p, { validate: false })).e?.code;
const entry = async (c, key) => (await c.call("settings.schema")).entries.find((e) => e.key === key);

export const tests = [
  ["schema: every entry is typed, enums carry values, numbers carry a default of their type, android keys are flagged", async (ctx) => {
    const c = await ui(ctx);
    const { entries } = await c.call("settings.schema");
    assert.ok(entries.length > 100, `${entries.length} entries`);
    assert.equal(new Set(entries.map((e) => e.key)).size, entries.length, "duplicate keys");
    for (const e of entries) {
      assert.ok(["bool", "int", "float", "string", "enum", "json", "secret"].includes(e.type), e.key);
      if (e.type === "enum") { assert.ok(e.enumValues?.length, e.key); assert.ok(e.enumValues.includes(e.default), `${e.key} default`); }
      if (e.type === "bool") assert.equal(typeof e.default, "boolean", e.key);
      if (e.type === "int" || e.type === "float") assert.equal(typeof e.default, "number", e.key);
    }
    for (const k of ["themeMode", "appLanguage", "seekDurationSeconds", "hideExplicit", "desktopFloatingPlayerBar", "minimizeToTrayOnClose", "lyricsAiApiKey"]) {
      assert.ok(entries.some((e) => e.key === k), `missing ${k}`);
    }
    assert.deepEqual((await entry(c, "themeMode")).enumValues, ["LIGHT", "DARK", "AUTO", "PURE_BLACK"]);
    assert.ok(entries.some((e) => e.platform === "android"));
    assert.equal((await entry(c, "desktopSidebarDocked")).platform, "desktop");
  }],

  ["get: all keys by default, a key subset, an unknown key is bad_request", async (ctx) => {
    const c = await ui(ctx);
    const all = (await c.call("settings.get")).values;
    assert.ok(Object.keys(all).length > 100);
    const some = (await c.call("settings.get", { keys: ["themeMode", "seekDurationSeconds"] })).values;
    assert.deepEqual(Object.keys(some).sort(), ["seekDurationSeconds", "themeMode"]);
    assert.equal(await code(c, "settings.get", { keys: ["nope"] }), "bad_request");
  }],

  ["secret: get returns {set} only, settings.set refuses it, lyrics.ai.setKey sets and clears it", async (ctx) => {
    const c = await ui(ctx);
    await c.call("lyrics.ai.setKey", { provider: "OpenRouter", key: "" });
    let v = (await c.call("settings.get", { keys: ["lyricsAiApiKey"] })).values.lyricsAiApiKey;
    assert.deepEqual(v, { set: false });
    assert.equal(await code(c, "settings.set", { values: { lyricsAiApiKey: "sk-secret" } }), "bad_request");
    await c.call("lyrics.ai.setKey", { provider: "OpenRouter", key: "sk-secret" });
    v = (await c.call("settings.get", { keys: ["lyricsAiApiKey"] })).values.lyricsAiApiKey;
    assert.deepEqual(v, { set: true });
    assert.ok(!JSON.stringify(await c.call("settings.get")).includes("sk-secret"), "secret leaked in get");
    assert.equal((await c.call("lyrics.ai.test", { provider: "OpenRouter" })).ok, true);
    await c.call("lyrics.ai.setKey", { provider: "OpenRouter", key: "" });
    assert.deepEqual((await c.call("settings.get", { keys: ["lyricsAiApiKey"] })).values.lyricsAiApiKey, { set: false });
  }],

  ["set: type, enum and range violations are bad_request and change nothing (atomic)", async (ctx) => {
    const c = await ui(ctx);
    await c.call("settings.reset", { keys: ["hideExplicit", "seekDurationSeconds", "themeMode"] });
    const seek = await entry(c, "seekDurationSeconds");
    assert.equal(await code(c, "settings.set", { values: { hideExplicit: "yes" } }), "bad_request");
    assert.equal(await code(c, "settings.set", { values: { themeMode: "SEPIA" } }), "bad_request");
    assert.equal(await code(c, "settings.set", { values: { seekDurationSeconds: seek.max + 1 } }), "bad_request");
    assert.equal(await code(c, "settings.set", { values: { seekDurationSeconds: 5.5 } }), "bad_request");
    assert.equal(await code(c, "settings.set", { values: { noSuchKey: 1 } }), "bad_request");
    // one bad entry rejects the whole call
    assert.equal(await code(c, "settings.set", { values: { hideExplicit: true, themeMode: "SEPIA" } }), "bad_request");
    const v = (await c.call("settings.get", { keys: ["hideExplicit", "seekDurationSeconds", "themeMode"] })).values;
    assert.equal(v.hideExplicit, false);
    assert.equal(v.seekDurationSeconds, seek.default);
    assert.equal(v.themeMode, (await entry(c, "themeMode")).default);
  }],

  ["set + reset round-trip; the settings topic: snapshot first, then changed deltas", async (ctx) => {
    const c = await ui(ctx);
    await c.call("settings.reset", { keys: ["hideExplicit", "themeMode"] });
    const sub = await c.sub("settings");
    const first = await c.waitEvent(() => true);
    assert.equal(first.ev, "settings.snapshot");
    assert.equal(first.sub, sub);
    assert.equal(first.p.values.hideExplicit, false);
    assert.ok(Object.keys(first.p.values).length > 100);
    await c.call("settings.set", { values: { hideExplicit: true, themeMode: "PURE_BLACK" } });
    const ch = await c.waitEvent((e) => e.ev === "settings.changed");
    assert.deepEqual(ch.p.changed, { hideExplicit: true, themeMode: "PURE_BLACK" });
    assert.ok(ch.seq > first.seq);
    assert.deepEqual((await c.call("settings.get", { keys: ["hideExplicit", "themeMode"] })).values, { hideExplicit: true, themeMode: "PURE_BLACK" });
    await c.call("settings.reset", { keys: ["hideExplicit", "themeMode"] });
    const back = await c.waitEvent((e) => e.ev === "settings.changed");
    assert.equal(back.p.changed.hideExplicit, false);
    assert.equal(back.p.changed.themeMode, (await entry(c, "themeMode")).default);
  }],

  ["set to the same value emits nothing; a float accepts an integer; a second connection sees the write", async (ctx) => {
    const c = await ui(ctx);
    const d = await ui(ctx);
    await c.call("settings.set", { values: { crossfadeDuration: 4 } });
    await d.sub("settings");
    await d.waitEvent((e) => e.ev === "settings.snapshot");
    await c.call("settings.set", { values: { crossfadeDuration: 4 } });
    await c.call("settings.set", { values: { crossfadeDuration: 6 } });
    const ch = await d.waitEvent((e) => e.ev === "settings.changed");
    assert.deepEqual(ch.p.changed, { crossfadeDuration: 6 });
    await c.call("settings.reset", { keys: ["crossfadeDuration"] });
  }],
];

export const mockOnly = [];
export const live = [];
