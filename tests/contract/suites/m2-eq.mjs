// M2 equalizer contract suite (api.md 3.8 + topic `eq`): state shape, band edits, undo/redo, profiles, APO import/export,
// AutoEq, per-device binding, eq.response (RBJ magnitudes) and the opt-in eq.spectrum stream.
// Runs on the mock (M2-3b) and must pass on the real core (M2-3a).
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Conn } from "../lib/conn.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const APO = resolve(here, "..", "..", "fixtures", "eq", "sample-apo.txt");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outDir = () => { const d = resolve(here, "..", "..", "..", ".testdata", "contract"); mkdirSync(d, { recursive: true }); return d; };

/** connect, enable the EQ and load the first built-in profile (the core keeps EQ state across connections) */
async function ui(ctx) {
  const c = await Conn.connect(ctx);
  ctx.cleanup.push(() => c.close());
  await c.call("eq.setEnabled", { on: true });
  const s0 = await c.call("eq.get");
  const flat = s0.profiles.find((p) => p.builtin);
  assert.ok(flat, "at least one built-in profile");
  await c.call("eq.setProfile", { id: flat.id });
  await c.call("eq.setAutoPreamp", { on: false });
  return { c, flat };
}
const stateEv = (c, pred = () => true) => c.waitEvent((e) => e.ev === "eq.state" && pred(e.p));
const peakAt = (r, hz) => { let best = 0, bd = Infinity; r.hz.forEach((f, i) => { const d = Math.abs(Math.log(f / hz)); if (d < bd) { bd = d; best = i; } }); return r.db[best]; };

export const tests = [
  ["eq.get: EqState shape, bands within limits, 32 max", async (ctx) => {
    const { c } = await ui(ctx);
    const s = await c.call("eq.get");
    assert.equal(s.maxBands, 32);
    assert.ok(s.bands.length >= 1 && s.bands.length <= 32);
    for (const b of s.bands) { assert.ok(["PK", "LSC", "HSC", "LPQ", "HPQ", "BP", "NO"].includes(b.type)); assert.ok(b.freq >= 20 && b.freq <= 20000); assert.ok(b.q > 0); }
    assert.ok(s.profiles.some((p) => p.id === s.profileId));
    assert.deepEqual(Object.keys(s.effects).sort(), ["bassDb", "crossfeed", "limiter", "outputDb", "trebleDb", "widthPct"]);
    assert.equal(typeof s.limiterReductionDb, "number");
  }],
  ["eq topic: snapshot first, eq.state after a change, no spectrum without the opt-in", async (ctx) => {
    const { c } = await ui(ctx);
    const sub = await c.sub("eq");
    const first = await c.waitEvent(() => true);
    assert.equal(first.ev, "eq.snapshot");
    assert.equal(first.sub, sub);
    await c.call("eq.updateBand", { index: 0, gain: 3 });
    const ev = await stateEv(c);
    assert.equal(ev.p.bands[0].gain, 3);
    assert.ok(ev.p.canUndo);
    await sleep(250);
    assert.equal(c.events.filter((e) => e.ev === "eq.spectrum").length, 0, "spectrum only on request");
  }],
  ["eq.updateBand: partial update and bad index", async (ctx) => {
    const { c } = await ui(ctx);
    await c.call("eq.updateBand", { index: 1, type: "PK", freq: 1000, gain: 4.5, q: 2 });
    let s = await c.call("eq.get");
    assert.deepEqual({ ...s.bands[1] }, { type: "PK", freq: 1000, gain: 4.5, q: 2 });
    await c.call("eq.updateBand", { index: 1, gain: -3 });
    s = await c.call("eq.get");
    assert.equal(s.bands[1].freq, 1000);
    assert.equal(s.bands[1].gain, -3);
    const e = await c.raw("eq.updateBand", { index: 999, gain: 1 });
    assert.equal(e.e?.code, "bad_request");
  }],
  ["eq.response: 256 points on a log grid 20 Hz to 20 kHz; flat = 0 dB; a +6 dB peak shows at its centre", async (ctx) => {
    const { c } = await ui(ctx);
    for (let i = 0; i < (await c.call("eq.get")).bands.length; i++) await c.call("eq.resetBand", { index: i });
    let r = await c.call("eq.response", { points: 256 });
    assert.equal(r.hz.length, 256);
    assert.equal(r.db.length, 256);
    assert.ok(Math.abs(r.hz[0] - 20) < 0.01 && Math.abs(r.hz[255] - 20000) < 1);
    assert.ok(r.hz.every((f, i) => i === 0 || f > r.hz[i - 1]), "increasing");
    assert.ok(r.db.every((d) => Math.abs(d) < 0.05), "flat");
    await c.call("eq.updateBand", { index: 5, type: "PK", freq: 1000, gain: 6, q: 1.41 });
    r = await c.call("eq.response", { points: 256 });
    assert.ok(Math.abs(peakAt(r, 1000) - 6) < 0.3, `peak ${peakAt(r, 1000)}`);
    assert.ok(Math.abs(peakAt(r, 20)) < 0.5 && Math.abs(peakAt(r, 20000)) < 0.5);
  }],
  ["eq.response: low/high shelf, low-pass and notch have the expected shape", async (ctx) => {
    const { c } = await ui(ctx);
    const n = (await c.call("eq.get")).bands.length;
    for (let i = 0; i < n; i++) await c.call("eq.resetBand", { index: i });
    await c.call("eq.updateBand", { index: 0, type: "LSC", freq: 100, gain: 8, q: 0.71 });
    let r = await c.call("eq.response", { points: 256 });
    assert.ok(peakAt(r, 20) > 7 && Math.abs(peakAt(r, 10000)) < 0.5, "low shelf");
    await c.call("eq.updateBand", { index: 0, type: "PK", gain: 0 });
    await c.call("eq.updateBand", { index: n - 1, type: "HSC", freq: 8000, gain: -6, q: 0.71 });
    r = await c.call("eq.response", { points: 256 });
    assert.ok(peakAt(r, 20000) < -5 && Math.abs(peakAt(r, 100)) < 0.5, "high shelf");
    await c.call("eq.updateBand", { index: n - 1, type: "PK", gain: 0 });
    await c.call("eq.updateBand", { index: 3, type: "NO", freq: 1000, gain: 0, q: 5 });
    r = await c.call("eq.response", { points: 256 });
    assert.ok(peakAt(r, 1000) < -10 && Math.abs(peakAt(r, 100)) < 0.5, "notch");
    await c.call("eq.updateBand", { index: 3, type: "LPQ", freq: 1000, gain: 0, q: 0.71 });
    r = await c.call("eq.response", { points: 256 });
    assert.ok(peakAt(r, 20000) < -30 && Math.abs(peakAt(r, 50)) < 0.5, "low-pass");
  }],
  ["eq.addBand / removeBand / resetBand, with the 32-band limit", async (ctx) => {
    const { c } = await ui(ctx);
    const n0 = (await c.call("eq.get")).bands.length;
    await c.call("eq.addBand", { freq: 3333 });
    let s = await c.call("eq.get");
    assert.equal(s.bands.length, n0 + 1);
    assert.ok(s.bands.some((b) => Math.abs(b.freq - 3333) < 1));
    const i = s.bands.findIndex((b) => Math.abs(b.freq - 3333) < 1);
    await c.call("eq.updateBand", { index: i, gain: 5 });
    await c.call("eq.resetBand", { index: i });
    s = await c.call("eq.get");
    assert.equal(s.bands[i].gain, 0);
    await c.call("eq.removeBand", { index: i });
    s = await c.call("eq.get");
    assert.equal(s.bands.length, n0);
    for (let k = s.bands.length; k < 32; k++) await c.call("eq.addBand", { freq: 100 + k * 37 });
    const full = await c.raw("eq.addBand", { freq: 5000 });
    assert.equal(full.e?.code, "bad_request", "33rd band refused");
    assert.equal((await c.call("eq.get")).bands.length, 32);
  }],
  ["eq undo / redo / reset", async (ctx) => {
    const { c } = await ui(ctx);
    await c.call("eq.reset");
    const base = (await c.call("eq.get")).bands[2].gain;
    await c.call("eq.updateBand", { index: 2, gain: base + 5 });
    let s = await c.call("eq.get");
    assert.equal(s.bands[2].gain, base + 5);
    assert.ok(s.canUndo);
    await c.call("eq.undo");
    s = await c.call("eq.get");
    assert.equal(s.bands[2].gain, base);
    assert.ok(s.canRedo);
    await c.call("eq.redo");
    assert.equal((await c.call("eq.get")).bands[2].gain, base + 5);
    await c.call("eq.reset");
    assert.equal((await c.call("eq.get")).bands[2].gain, base);
  }],
  ["eq preamp, auto preamp, effects", async (ctx) => {
    const { c } = await ui(ctx);
    await c.call("eq.setPreamp", { db: -4 });
    assert.equal((await c.call("eq.get")).preampDb, -4);
    await c.call("eq.updateBand", { index: 3, type: "PK", freq: 500, gain: 9, q: 1 });
    await c.call("eq.setAutoPreamp", { on: true });
    const s = await c.call("eq.get");
    assert.equal(s.autoPreamp, true);
    assert.ok(s.preampDb < -5, `auto preamp ${s.preampDb}`);
    await c.call("eq.setEffects", { bassDb: 3, trebleDb: -2, widthPct: 120, crossfeed: "chuMoy", limiter: false, outputDb: -1.5 });
    const e = (await c.call("eq.get")).effects;
    assert.deepEqual({ ...e }, { bassDb: 3, trebleDb: -2, widthPct: 120, crossfeed: "chuMoy", limiter: false, outputDb: -1.5 });
    const bad = await c.raw("eq.setEffects", { crossfeed: "nope" }, { validate: false });
    assert.equal(bad.e?.code, "bad_request");
    await c.call("eq.setEffects", { bassDb: 0, trebleDb: 0, widthPct: 100, crossfeed: "off", limiter: true, outputDb: 0 });
  }],
  ["eq profiles: save as new, overwrite, rename, delete, built-in protected, setProfile", async (ctx) => {
    const { c, flat } = await ui(ctx);
    await c.call("eq.updateBand", { index: 0, gain: 2.5 });
    const { id } = await c.call("eq.profile.save", { name: "Contract A", asNew: true });
    let s = await c.call("eq.get");
    assert.equal(s.profileId, id);
    assert.ok(s.profiles.find((p) => p.id === id && p.name === "Contract A" && !p.builtin));
    await c.call("eq.updateBand", { index: 0, gain: 4 });
    const again = await c.call("eq.profile.save", { name: "Contract A", asNew: false });
    assert.equal(again.id, id, "overwrite keeps the id");
    await c.call("eq.setProfile", { id: flat.id });
    await c.call("eq.setProfile", { id });
    assert.equal((await c.call("eq.get")).bands[0].gain, 4);
    await c.call("eq.profile.rename", { id, name: "Contract B" });
    assert.ok((await c.call("eq.get")).profiles.find((p) => p.id === id && p.name === "Contract B"));
    assert.equal((await c.raw("eq.profile.delete", { id: flat.id })).e?.code, "bad_request");
    await c.call("eq.profile.delete", { id });
    s = await c.call("eq.get");
    assert.ok(!s.profiles.some((p) => p.id === id));
    assert.notEqual(s.profileId, id);
    assert.equal((await c.raw("eq.setProfile", { id: "nope" })).e?.code, "not_found");
  }],
  ["eq.importFile / eq.exportFile: APO round trip", async (ctx) => {
    const { c } = await ui(ctx);
    const { id } = await c.call("eq.importFile", { path: APO });
    const s = await c.call("eq.get");
    assert.equal(s.profileId, id);
    assert.equal(s.bands.length, 5, "the OFF filter is skipped");
    assert.ok(Math.abs(s.preampDb + 5.8) < 0.05);
    assert.equal(s.bands[0].type, "LSC");
    assert.equal(s.bands[0].freq, 105);
    assert.equal(s.bands[0].gain, 6.5);
    const out = join(outDir(), `eq-export-${Date.now()}.txt`);
    await c.call("eq.exportFile", { id, path: out });
    const text = readFileSync(out, "utf8");
    assert.match(text, /^Preamp: -5\.8 dB/m);
    assert.equal(text.split("\n").filter((l) => l.startsWith("Filter")).length, 5);
    const id2 = (await c.call("eq.importFile", { path: out })).id;
    const s2 = await c.call("eq.get");
    assert.equal(s2.profileId, id2);
    assert.deepEqual(s2.bands.map((b) => [b.type, b.freq, b.gain]), s.bands.map((b) => [b.type, b.freq, b.gain]));
    await c.call("eq.profile.delete", { id });
    await c.call("eq.profile.delete", { id: id2 });
    assert.equal((await c.raw("eq.importFile", { path: join(outDir(), "missing-file.txt") })).e?.code, "not_found");
  }],
  ["eq.autoeq.search / apply", async (ctx) => {
    const { c } = await ui(ctx);
    const r = await c.call("eq.autoeq.search", { q: "sony" });
    assert.ok(r.items.length >= 1);
    for (const it of r.items) { assert.equal(typeof it.name, "string"); assert.equal(typeof it.source, "string"); assert.ok(Array.isArray(it.variants)); }
    assert.equal((await c.call("eq.autoeq.search", { q: "zzzz-no-such-headphone" })).items.length, 0);
    const pick = r.items[0];
    const { id } = await c.call("eq.autoeq.apply", { name: pick.name, ...(pick.variants[0] ? { variant: pick.variants[0] } : {}) });
    const s = await c.call("eq.get");
    assert.equal(s.profileId, id);
    assert.ok(s.profiles.some((p) => p.id === id));
    assert.ok(s.bands.some((b) => b.gain !== 0));
    await c.call("eq.profile.delete", { id });
  }],
  ["eq.device.bind: bind and unbind a profile for an output device", async (ctx) => {
    const { c, flat } = await ui(ctx);
    const { devices } = await c.call("player.output.list");
    const dev = devices[0];
    await c.call("eq.device.bind", { deviceId: dev.id, profileId: flat.id });
    let s = await c.call("eq.get");
    assert.ok(s.deviceProfiles.some((d) => d.deviceId === dev.id && d.profileId === flat.id));
    await c.call("eq.device.bind", { deviceId: dev.id, profileId: null });
    s = await c.call("eq.get");
    assert.ok(!s.deviceProfiles.some((d) => d.deviceId === dev.id));
  }],
  ["eq.spectrum: 32 base64 bytes at <= 30 Hz, only while subscribed with {spectrum:true}", async (ctx) => {
    const { c } = await ui(ctx);
    const sub = await c.sub("eq", { spectrum: true });
    await c.waitEvent((e) => e.ev === "eq.snapshot" && e.sub === sub);
    const t0 = Date.now();
    const evs = [];
    for (let i = 0; i < 5; i++) evs.push(await c.waitEvent((e) => e.ev === "eq.spectrum" && e.sub === sub, 3000));
    const dt = Date.now() - t0;
    for (const e of evs) assert.equal(Buffer.from(e.p.b64, "base64").length, 32);
    assert.ok(dt >= 4 * 30, `5 frames in ${dt} ms is faster than 30 Hz`);
    await c.call("sub.close", { sub });
    await sleep(150);
    c.events.length = 0;
    await sleep(300);
    assert.equal(c.events.filter((e) => e.ev === "eq.spectrum").length, 0, "stops after sub.close");
  }],
];
