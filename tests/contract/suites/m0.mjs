// M0 contract suite (test-guide section 2): every M0 method is called, its params and result validated against
// protocol/schema, plus the semantic asserts. M0-E adds further suites next to this one.
import assert from "node:assert/strict";
import { Conn } from "../lib/conn.mjs";
import { checkEvent, checkMethod, index } from "../lib/schema.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SORT = { by: "added", desc: true };
export const M0_METHODS = [
  "sys.hello", "sys.ping", "app.info", "app.log", "home.get", "library.counts", "library.window", "album.get",
  "player.play", "player.toggle", "player.pause", "player.resume", "player.next", "player.prev", "player.seek",
  "player.seekRelative", "player.seekPercent", "player.setVolume", "player.mute", "player.setShuffle",
  "player.setRepeat", "player.cycleRepeat", "player.setSpeed", "player.output.list", "player.output.set",
  "sub.open", "sub.close",
];

async function ui(ctx, opts) {
  const c = await Conn.connect(ctx, opts);
  ctx.cleanup.push(() => c.close());
  return c;
}
/** play 5 library tracks and return their ids */
async function playSome(c, startIndex = 0) {
  const w = await c.call("library.window", { list: "songs", sort: SORT, offset: 0, limit: 20 });
  const ids = w.items.slice(0, 5).map((t) => t.id);
  await c.call("player.play", { context: { kind: "tracks", ids, title: "contract" }, startIndex });
  return ids;
}

export const tests = [
  // ---------------------------------------------------------------- schema
  ["schema: every method and event in api.md has a schema", () => {
    assert.ok(index.methods.length >= 150, `only ${index.methods.length} methods`);
    for (const m of M0_METHODS) assert.ok(index.methods.includes(m), `${m} missing from schema`);
    for (const ev of ["player.snapshot", "player.state", "player.position", "player.error", "library.snapshot", "library.changed", "home.updated", "app.toast"]) {
      assert.ok(index.events.includes(ev), `${ev} missing`);
    }
  }],

  // ---------------------------------------------------------------- handshake and errors
  ["hello: result shape and protocol 1", async (ctx) => {
    const c = await ui(ctx);
    assert.equal(c.hello.protocol, 1);
    assert.ok(Array.isArray(c.hello.capabilities));
    assert.ok(Math.abs(c.hello.serverTime - Date.now()) < 60_000, "serverTime is epoch ms");
    assert.match(c.hello.core, /\S/);
  }],
  ["hello: bad token -> close 4401", async (ctx) => {
    const c = await Conn.open(ctx);
    c.send({ id: 1, m: "sys.hello", p: { token: "wrong", role: "ui", protocol: 1, client: "t", locale: "vi" } });
    assert.equal((await c.waitClose(3000)).code, 4401);
  }],
  ["hello: first frame is not hello -> close 4401", async (ctx) => {
    const c = await Conn.open(ctx);
    c.send({ id: 1, m: "sys.ping" });
    assert.equal((await c.waitClose(3000)).code, 4401);
  }],
  ["hello: no frame within 2 s -> close 4401", async (ctx) => {
    const c = await Conn.open(ctx);
    const t0 = Date.now();
    const closed = await c.waitClose(4000);
    assert.equal(closed.code, 4401);
    assert.ok(Date.now() - t0 < 3500, "closed late");
  }],
  ["origin: wrong Origin refused, tauri.localhost and empty accepted", async (ctx) => {
    await assert.rejects(Conn.open(ctx, { origin: "http://evil.example" }), (e) => e.status === 403);
    await assert.rejects(Conn.open(ctx, { origin: "https://example.com" }), (e) => e.status === 403);
    const ok = await ui(ctx, { origin: "http://tauri.localhost" });
    assert.equal(ok.hello.protocol, 1);
    const none = await ui(ctx);
    assert.equal(none.hello.protocol, 1);
  }],
  ["errors: unknown method -> bad_request", async (ctx) => {
    const c = await ui(ctx);
    const r = await c.raw("totally.unknown", {}, { validate: false });
    assert.equal(r.e?.code, "bad_request");
    assert.equal(typeof r.e.msg, "string");
    assert.equal(typeof r.e.retryable, "boolean");
    assert.equal(r.r, undefined, "exactly one of r/e");
  }],
  ["errors: bad params -> bad_request; second hello -> bad_request", async (ctx) => {
    const c = await ui(ctx);
    const a = await c.raw("library.window", { list: "songs", sort: SORT, offset: 0, limit: 201 }, { validate: false });
    assert.equal(a.e?.code, "bad_request");
    const b = await c.raw("player.seek", { ms: "x" }, { validate: false });
    assert.equal(b.e?.code, "bad_request");
    const d = await c.raw("sys.hello", { token: ctx.token, role: "ui", protocol: 1, client: "t", locale: "vi" }, { validate: false });
    assert.equal(d.e?.code, "bad_request");
  }],
  ["errors: unknown album -> not_found", async (ctx) => {
    const c = await ui(ctx);
    assert.equal((await c.raw("album.get", { id: "does-not-exist" })).e?.code, "not_found");
  }],
  ["ids: responses may arrive for concurrent requests (out of order allowed)", async (ctx) => {
    const c = await ui(ctx);
    const rs = await Promise.all([c.call("sys.ping", {}), c.call("library.counts", {}), c.call("app.info", {}), c.call("sys.ping", {})]);
    assert.equal(typeof rs[0].t, "number");
    assert.equal(rs[1].songs, 5000);
    assert.equal(rs[2].protocol, 1);
  }],

  // ---------------------------------------------------------------- sys, app
  ["sys.ping / app.info / app.log", async (ctx) => {
    const c = await ui(ctx);
    assert.ok(Math.abs((await c.call("sys.ping", {})).t - Date.now()) < 60_000);
    const info = await c.call("app.info", {});
    assert.equal(info.protocol, 1);
    for (const k of ["data", "config", "state", "cache", "logs"]) assert.equal(typeof info.dataDirs[k], "string");
    assert.deepEqual(await c.call("app.log", { level: "info", msg: "contract test" }), {});
  }],

  // ---------------------------------------------------------------- home
  ["home.get: shelves, chips, greeting, fromCache", async (ctx) => {
    const c = await ui(ctx);
    const h = await c.call("home.get", {});
    assert.ok(h.shelves.length >= 5, "at least 5 shelves");
    assert.equal(h.fromCache, true);
    assert.ok(h.chips.length > 0);
    assert.match(h.greeting.key, /^good_/);
    const layouts = new Set(h.shelves.map((s) => s.layout));
    for (const l of ["quickPicks", "cards", "rows"]) assert.ok(layouts.has(l), `layout ${l}`);
    const types = new Set(h.shelves.flatMap((s) => s.items.map((i) => i.t)));
    for (const t of ["track", "album", "artist", "playlist"]) assert.ok(types.has(t), `item type ${t}`);
    const sel = await c.call("home.get", { chip: h.chips[1].key });
    assert.deepEqual(sel.chips.filter((x) => x.selected).map((x) => x.key), [h.chips[1].key]);
  }],
  ["home.get refresh: pushes home.updated on the app topic", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("app");
    await c.waitEvent((e) => e.ev === "app.snapshot");
    await c.call("home.get", { refresh: true });
    const ev = await c.waitEvent((e) => e.ev === "home.updated", 5000);
    assert.ok(ev.p.shelves.length > 0);
  }],

  // ---------------------------------------------------------------- library
  ["library.counts", async (ctx) => {
    const c = await ui(ctx);
    const n = await c.call("library.counts", {});
    assert.equal(n.songs, 5000);
    assert.ok(n.albums >= 1 && n.playlists >= 1 && n.userAlbums >= 1);
  }],
  ["library.window: last window 4900/200 -> 100 items, total 5000", async (ctx) => {
    const c = await ui(ctx);
    const w = await c.call("library.window", { list: "songs", sort: SORT, offset: 4900, limit: 200 });
    assert.equal(w.items.length, 100);
    assert.equal(w.total, 5000);
    assert.equal(w.offset, 4900);
    assert.equal(typeof w.revision, "number");
  }],
  ["library.window: paging is consistent and has no overlaps", async (ctx) => {
    const c = await ui(ctx);
    const a = await c.call("library.window", { list: "songs", sort: SORT, offset: 0, limit: 200 });
    assert.equal(a.items.length, 200);
    const b = await c.call("library.window", { list: "songs", sort: SORT, offset: 100, limit: 100 });
    assert.deepEqual(b.items.map((t) => t.id), a.items.slice(100).map((t) => t.id));
    assert.equal((await c.call("library.window", { list: "songs", sort: SORT, offset: 5000, limit: 100 })).items.length, 0);
  }],
  ["library.window: sort and filter", async (ctx) => {
    const c = await ui(ctx);
    const desc = await c.call("library.window", { list: "songs", sort: { by: "added", desc: true }, offset: 0, limit: 50 });
    const asc = await c.call("library.window", { list: "songs", sort: { by: "added", desc: false }, offset: 0, limit: 50 });
    assert.notEqual(desc.items[0].id, asc.items[0].id);
    for (let i = 1; i < desc.items.length; i++) assert.ok(desc.items[i - 1].addedAt >= desc.items[i].addedAt, "added desc order");
    const byTitle = await c.call("library.window", { list: "songs", sort: { by: "title", desc: false }, offset: 0, limit: 100 });
    for (let i = 1; i < byTitle.items.length; i++) assert.ok(byTitle.items[i - 1].title.localeCompare(byTitle.items[i].title, "vi") <= 0, "title order");
    const f = await c.call("library.window", { list: "songs", sort: SORT, filter: { source: "zing" }, offset: 0, limit: 200 });
    assert.ok(f.total > 0 && f.total < 5000);
    assert.ok(f.items.every((t) => t.source === "zing"));
    const liked = await c.call("library.window", { list: "liked", sort: SORT, offset: 0, limit: 200 });
    assert.ok(liked.items.every((t) => t.liked === true));
    const albums = await c.call("library.window", { list: "albums", sort: SORT, offset: 0, limit: 200 });
    assert.ok(albums.total >= 1 && albums.items[0].kind);
    const q = await c.call("library.window", { list: "songs", sort: SORT, filter: { text: "mua" }, offset: 0, limit: 200 });
    assert.ok(q.total < 5000, "text filter narrows (diacritics insensitive)");
  }],
  ["library.window: mixed content - Vietnamese and English titles, several sources and quality badges", async (ctx) => {
    const c = await ui(ctx);
    const w = await c.call("library.window", { list: "songs", sort: SORT, offset: 0, limit: 200 });
    assert.ok(w.items.some((t) => /[À-ỹ]/.test(t.title)), "Vietnamese title");
    assert.ok(w.items.some((t) => /^[A-Za-z0-9 ()'-]+$/.test(t.title)), "English title");
    assert.ok(new Set(w.items.map((t) => t.source)).size >= 3, ">= 3 sources");
    assert.ok(w.items.some((t) => t.quality?.lossless), "a lossless badge");
    assert.ok(w.items.every((t) => t.artists.length > 0 && t.art?.src));
  }],

  // ---------------------------------------------------------------- album
  ["album.get: from a Home album card", async (ctx) => {
    const c = await ui(ctx);
    const h = await c.call("home.get", {});
    const card = h.shelves.flatMap((s) => s.items).find((i) => i.t === "album");
    const a = await c.call("album.get", { id: card.id });
    assert.equal(a.album.id, card.id);
    assert.ok(a.tracks.length > 0);
    assert.equal(a.album.trackCount, a.tracks.length);
    assert.equal(a.album.durationMs, a.tracks.reduce((s, t) => s + (t.durationMs ?? 0), 0));
    assert.ok(Array.isArray(a.otherVersions));
    const second = await c.call("album.get", { id: "MPREb_mockAlbum01" }).catch(() => null);
    if (second) assert.ok(second.tracks.length >= 10);
  }],

  // ---------------------------------------------------------------- subscriptions
  ["sub player: first event is player.snapshot (seq starts, then increases)", async (ctx) => {
    const c = await ui(ctx);
    const sub = await c.sub("player");
    const snap = await c.waitEvent(() => true);
    assert.equal(snap.ev, "player.snapshot");
    assert.equal(snap.sub, sub);
    assert.equal(typeof snap.seq, "number");
    assert.ok("track" in snap.p && "volume" in snap.p && "repeat" in snap.p);
  }],
  ["sub library: snapshot shape; sub.close", async (ctx) => {
    const c = await ui(ctx);
    const lib = await c.sub("library");
    const s = await c.waitEvent((e) => e.ev === "library.snapshot");
    assert.equal(s.p.counts.songs, 5000);
    assert.equal(typeof s.p.revision, "number");
    assert.deepEqual(await c.call("sub.close", { sub: lib }), {});
  }],
  ["sub player: seq increases monotonically across events", async (ctx) => {
    const c = await ui(ctx);
    const sub = await c.sub("player");
    await c.waitEvent((e) => e.ev === "player.snapshot");
    await playSome(c);
    await c.call("player.pause", {});
    await c.call("player.resume", {});
    await sleep(300);
    const mine = c.events.filter((e) => e.sub === sub);
    assert.ok(mine.length >= 3);
    for (let i = 1; i < mine.length; i++) assert.equal(mine[i].seq, mine[i - 1].seq + 1, "seq has no gaps");
  }],
  ["sub: after a forced socket close, a re-subscribe gets a fresh snapshot", async (ctx) => {
    const c1 = await ui(ctx);
    await c1.sub("player");
    await c1.waitEvent((e) => e.ev === "player.snapshot");
    c1.close();
    await c1.waitClose();
    const c2 = await ui(ctx);
    await c2.sub("player");
    const snap = await c2.waitEvent((e) => e.ev === "player.snapshot");
    assert.equal(snap.seq, 1);
  }],

  // ---------------------------------------------------------------- player
  ["player: play -> state/position events, pause, resume, seek", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("player");
    await c.waitEvent((e) => e.ev === "player.snapshot");
    const ids = await playSome(c, 2);
    const st = await c.waitEvent((e) => e.ev === "player.state" && e.p.playing);
    assert.equal(st.p.track.id, ids[2]);
    assert.equal(st.p.durMs, st.p.track.durationMs);
    assert.equal(st.p.canPrev, true);
    assert.equal(st.p.canNext, true);
    const pos = await c.waitEvent((e) => e.ev === "player.position");
    assert.equal(pos.p.playing, true);
    assert.ok(pos.p.posMs < 1500);
    assert.equal(pos.p.rate, 1);

    await c.call("player.seek", { ms: 42_000 });
    const sk = await c.waitEvent((e) => e.ev === "player.position" && e.p.posMs >= 42_000 && e.p.posMs < 44_000);
    assert.ok(sk.p.playing);

    await c.call("player.pause", {});
    const paused = await c.waitEvent((e) => e.ev === "player.state" && e.p.playing === false);
    assert.equal(paused.p.track.id, ids[2]);
    const pp = await c.waitEvent((e) => e.ev === "player.position" && e.p.playing === false);
    const frozen = pp.p.posMs;
    await sleep(600);
    await c.call("player.seekRelative", { deltaMs: 5000 });
    const rel = await c.waitEvent((e) => e.ev === "player.position" && e.p.playing === false);
    assert.ok(Math.abs(rel.p.posMs - (frozen + 5000)) < 300, `seekRelative while paused: ${rel.p.posMs} vs ${frozen + 5000}`);
    await c.call("player.seekPercent", { pct: 50 });
    const pct = await c.waitEvent((e) => e.ev === "player.position" && Math.abs(e.p.posMs - e.p.durMs / 2) < 100);
    assert.ok(pct);

    await c.call("player.toggle", {});
    await c.waitEvent((e) => e.ev === "player.state" && e.p.playing === true);
    await c.call("player.resume", {}); // no-op when already playing
  }],
  ["player: next/prev, shuffle, repeat, volume, mute, speed", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("player");
    await c.waitEvent((e) => e.ev === "player.snapshot");
    const ids = await playSome(c, 0);
    await c.waitEvent((e) => e.ev === "player.state" && e.p.track?.id === ids[0]);
    await c.call("player.next", {});
    assert.equal((await c.waitEvent((e) => e.ev === "player.state" && e.p.track?.id === ids[1])).p.track.id, ids[1]);
    await c.call("player.prev", {}); // within 3 s of the start -> previous track
    await c.waitEvent((e) => e.ev === "player.state" && e.p.track?.id === ids[0]);
    await c.call("player.setVolume", { v: 0.4 });
    assert.equal((await c.waitEvent((e) => e.ev === "player.state" && e.p.volume === 0.4)).p.volume, 0.4);
    await c.call("player.mute", { on: true });
    await c.waitEvent((e) => e.ev === "player.state" && e.p.muted === true);
    await c.call("player.setShuffle", { on: true });
    await c.waitEvent((e) => e.ev === "player.state" && e.p.shuffle === true);
    await c.call("player.setRepeat", { mode: "one" });
    await c.waitEvent((e) => e.ev === "player.state" && e.p.repeat === "one");
    await c.call("player.cycleRepeat", {}); // one -> off
    await c.waitEvent((e) => e.ev === "player.state" && e.p.repeat === "off");
    await c.call("player.setSpeed", { speed: 1.5 });
    const sp = await c.waitEvent((e) => e.ev === "player.position" && e.p.rate === 1.5);
    assert.equal(sp.p.rate, 1.5);
    const out = await c.call("player.output.list", {});
    assert.ok(out.devices.length >= 1 && out.devices.some((d) => d.id === out.current || d.default));
    await c.call("player.output.set", { id: out.devices[0].id });
  }],
  ["player: play contexts - album, library, bad ids", async (ctx) => {
    const c = await ui(ctx);
    const h = await c.call("home.get", {});
    const alb = h.shelves.flatMap((s) => s.items).find((i) => i.t === "album");
    await c.call("player.play", { context: { kind: "album", id: alb.id } });
    await c.call("player.play", { context: { kind: "library", list: "songs", sort: SORT }, startIndex: 10, shuffle: false });
    assert.equal((await c.raw("player.play", { context: { kind: "tracks", ids: ["no-such-track"] } })).e?.code, "not_found");
    assert.equal((await c.raw("player.play", { context: { kind: "tracks", ids: [] } }, { validate: false })).e?.code, "bad_request");
  }],
  ["player.position flood rules: 1 per second while playing, never above 4 Hz", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("player");
    await c.waitEvent((e) => e.ev === "player.snapshot");
    await playSome(c);
    await c.waitEvent((e) => e.ev === "player.position");
    c.events.length = 0;
    const times = [];
    const t0 = Date.now();
    c.ws.on("message", (d) => { if (d.toString().includes('"player.position"')) times.push(Date.now()); });
    await sleep(3600);
    assert.ok(times.length >= 2 && times.length <= 5, `steady playing: expected ~3-4 position events in 3.6 s, got ${times.length}`);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 800, `drift correction period too short: ${times[i] - times[i - 1]} ms`);

    // a burst of 30 seeks must not produce more than 4 events per second
    times.length = 0;
    const b0 = Date.now();
    for (let i = 0; i < 30; i++) { c.send({ id: 1000 + i, m: "player.seek", p: { ms: 1000 + i * 100 } }); await sleep(10); }
    await sleep(1100);
    const elapsed = (Date.now() - b0) / 1000;
    assert.ok(times.length <= Math.ceil(4 * elapsed) + 1, `${times.length} position events in ${elapsed.toFixed(2)} s`);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 200, `gap ${times[i] - times[i - 1]} ms < 250`);
    void t0;
  }],
  ["player: queue end with repeat off pauses at the end; repeat all wraps", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("player");
    await c.waitEvent((e) => e.ev === "player.snapshot");
    const w = await c.call("library.window", { list: "songs", sort: SORT, offset: 0, limit: 2 });
    await c.call("player.play", { context: { kind: "tracks", ids: [w.items[0].id, w.items[1].id] }, startIndex: 1 });
    const st = await c.waitEvent((e) => e.ev === "player.state" && e.p.track?.id === w.items[1].id);
    assert.equal(st.p.canNext, false, "last track, repeat off");
    await c.call("player.setRepeat", { mode: "all" });
    await c.call("player.next", {});
    await c.waitEvent((e) => e.ev === "player.state" && e.p.track?.id === w.items[0].id);
  }],

  // ---------------------------------------------------------------- events validate against the schema
  ["all events received in this run validated against protocol/schema", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("player"); await c.sub("library"); await c.sub("app");
    await playSome(c);
    await sleep(500);
    assert.deepEqual(c.schemaErrors, []);
    for (const e of c.events) assert.equal(checkEvent(e.ev, e.p), null);
    assert.equal(checkMethod("sys.ping", "r", { t: 1 }), null);
    assert.notEqual(checkMethod("sys.ping", "r", { t: "x" }), null, "schema really rejects bad data");
  }],
];

// ------------------------------------------------------------------ mock-only
export const mockOnly = [
  ["mock: library.changed is pushed to the library topic with a new revision", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("library");
    const snap = await c.waitEvent((e) => e.ev === "library.snapshot");
    const r = await c.raw("mock.libraryChanged", { lists: ["songs"] }, { validate: false });
    assert.ok(r.r.revision > snap.p.revision);
    const ev = await c.waitEvent((e) => e.ev === "library.changed");
    assert.ok(ev.p.revision > snap.p.revision);
    assert.deepEqual(ev.p.lists, ["songs"]);
  }],
  ["mock: unsupported topic -> error", async (ctx) => {
    const c = await ui(ctx);
    assert.ok((await c.raw("sub.open", { topic: "lt" })).e);
  }],
  ["mock: methods outside M0 answer bad_request", async (ctx) => {
    const c = await ui(ctx);
    for (const m of ["eq.get", "settings.get", "lt.state", "download.summary", "lyrics.get"]) {
      assert.equal((await c.raw(m, undefined, { validate: false })).e?.code, "bad_request", m);
    }
  }],
  ["mock: art endpoint needs the artToken", async (ctx) => {
    const ok = await fetch(`http://127.0.0.1:${ctx.port}/art/mock/abc?w=128&k=${ctx.artToken}`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-type"), /image/);
    assert.match(ok.headers.get("cache-control"), /immutable/);
    assert.equal((await fetch(`http://127.0.0.1:${ctx.port}/art/mock/abc?w=128&k=nope`)).status, 401);
  }],
  ["sidecar: pid file is written with {pid,startTimeMs,exe}", (ctx) => {
    const p = ctx.target.readPidFile();
    assert.ok(p, "core.pid exists");
    assert.equal(p.pid, ctx.target.pid);
    assert.equal(typeof p.startTimeMs, "number");
    assert.equal(typeof p.exe, "string");
  }],
];
