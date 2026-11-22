// M1 queue contract suite: player.play with every context kind, queue.window/add/addContext/setAutoplay, the `queue` topic
// (snapshot first, seq increases, queue.changed), auto-advance and autoplay.
// Offline contexts (tracks, library, userAlbum) run on both targets; album/playlist/artist/radio need the network on the real core
// (mock: in mockOnly, real: in `live`). The auto-advance test with real yt ids is in `live`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Conn } from "../lib/conn.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SORT = { by: "added", desc: true };
/** connect and reset the playback modes: the core (and the mock) keeps them across connections */
async function ui(ctx) {
  const c = await Conn.connect(ctx);
  ctx.cleanup.push(() => c.close());
  await c.call("player.setShuffle", { on: false });
  await c.call("player.setRepeat", { mode: "off" });
  await c.call("queue.setAutoplay", { on: false });
  return c;
}
const ids = async (c, n, offset = 0) =>
  (await c.call("library.window", { list: "songs", sort: SORT, offset, limit: n })).items.map((t) => t.id);
async function subscribeAll(c) {
  await c.sub("player");
  await c.sub("queue");
  await c.waitEvent((e) => e.ev === "player.snapshot");
  await c.waitEvent((e) => e.ev === "queue.snapshot");
}
const qw = (c, offset = 0, limit = 200) => c.call("queue.window", { offset, limit });

export const tests = [
  ["queue topic: the snapshot comes first, seq increases, queue.changed follows a play", async (ctx) => {
    const c = await ui(ctx);
    const sub = await c.sub("queue");
    const first = await c.waitEvent(() => true);
    assert.equal(first.ev, "queue.snapshot");
    assert.equal(first.sub, sub);
    assert.equal(first.seq, 1);
    for (const k of ["total", "revision", "currentIndex", "head"]) assert.ok(k in first.p, k);
    assert.ok(first.p.head.length <= 50);
    await c.call("player.play", { context: { kind: "tracks", ids: await ids(c, 3), title: "q" } });
    const ch = await c.waitEvent((e) => e.ev === "queue.changed");
    assert.ok(ch.seq > first.seq);
    assert.equal(typeof ch.p.revision, "number");
    assert.equal(ch.p.currentIndex, 0);
  }],
  ["player.play kind tracks: the queue is the resolved list, startIndex and startId", async (ctx) => {
    const c = await ui(ctx);
    const list = await ids(c, 5);
    await c.call("player.play", { context: { kind: "tracks", ids: list, title: "t" }, startIndex: 2 });
    let q = await qw(c);
    assert.deepEqual(q.items.map((t) => t.id), list);
    assert.equal(q.currentIndex, 2);
    assert.equal(new Set(q.items.map((t) => t.qid)).size, 5, "qids are unique");
    await c.call("player.play", { context: { kind: "tracks", ids: list }, startId: list[4] });
    q = await qw(c);
    assert.equal(q.currentIndex, 4);
  }],
  ["player.play kind library: the queue holds the whole sorted list; window 4900/200 -> 100", async (ctx) => {
    const c = await ui(ctx);
    await c.call("player.play", { context: { kind: "library", list: "songs", sort: SORT }, startIndex: 10 });
    const q = await qw(c, 4900, 200);
    assert.equal(q.total, 5000);
    assert.equal(q.items.length, 100);
    assert.equal((await qw(c, 0, 1)).currentIndex, 10);
    const snapSub = await c.sub("queue");
    const snap = await c.waitEvent((e) => e.ev === "queue.snapshot" && e.sub === snapSub);
    assert.ok(snap.p.head.length <= 50 && snap.p.head.length > 0);
    assert.equal(snap.p.head[0].qid, (await qw(c, 5, 1)).items[0].qid, "head starts at currentIndex - 5");
  }],
  ["player.play kind userAlbum", async (ctx) => {
    const c = await ui(ctx);
    const ua = (await c.call("userAlbum.list", {})).items.find((u) => u.count > 3);
    await c.call("player.play", { context: { kind: "userAlbum", id: ua.id } });
    const q = await qw(c);
    assert.equal(q.total, ua.count);
  }],
  ["queue.add next / end / index; queue.addContext", async (ctx) => {
    const c = await ui(ctx);
    const base = await ids(c, 5);
    const extra = await ids(c, 4, 100);
    await c.call("player.play", { context: { kind: "tracks", ids: base }, startIndex: 1 });
    const r1 = await c.call("queue.add", { ids: [extra[0]], position: "next" });
    assert.equal(typeof r1.revision, "number");
    let q = await qw(c);
    assert.equal(q.items[2].id, extra[0], "next goes right after the current track");
    assert.equal(q.currentIndex, 1);
    const r2 = await c.call("queue.add", { ids: [extra[1]], position: "end" });
    assert.ok(r2.revision > r1.revision);
    q = await qw(c);
    assert.equal(q.items.at(-1).id, extra[1]);
    await c.call("queue.add", { ids: [extra[2]], position: 0 });
    q = await qw(c);
    assert.equal(q.items[0].id, extra[2]);
    assert.equal(q.currentIndex, 2, "inserting before the current track shifts currentIndex");
    const total = q.total;
    await c.call("queue.addContext", { context: { kind: "tracks", ids: [extra[3], base[0]] }, position: "end" });
    assert.equal((await qw(c, 0, 1)).total, total + 2);
  }],
  ["queue.setAutoplay answers {} and is reflected in canNext at the end of the queue", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("player");
    await c.waitEvent((e) => e.ev === "player.snapshot");
    const two = await ids(c, 2);
    c.events.length = 0; // drop state events caused by the previous test track
    await c.call("player.play", { context: { kind: "tracks", ids: two }, startIndex: 1 });
    const off = await c.waitEvent((e) => e.ev === "player.state" && e.p.track?.id === two[1]);
    assert.equal(off.p.canNext, false, "last track, autoplay off");
    assert.deepEqual(await c.call("queue.setAutoplay", { on: true }), {});
    const on = await c.waitEvent((e) => e.ev === "player.state" && e.p.canNext === true);
    assert.equal(on.p.track.id, two[1]);
    await c.call("queue.setAutoplay", { on: false });
  }],
  ["errors: unknown ids and bad positions", async (ctx) => {
    const c = await ui(ctx);
    assert.equal((await c.raw("queue.add", { ids: ["no-such-track"], position: "end" })).e?.code, "not_found");
    assert.equal((await c.raw("queue.add", { ids: [], position: "sideways" }, { validate: false })).e?.code, "bad_request");
    assert.equal((await c.raw("queue.window", { offset: 0, limit: 500 }, { validate: false })).e?.code, "bad_request");
  }],
  ["all queue/player events validated against the schema", async (ctx) => {
    const c = await ui(ctx);
    await subscribeAll(c);
    await c.call("player.play", { context: { kind: "tracks", ids: await ids(c, 3) } });
    await c.call("queue.add", { ids: await ids(c, 1, 50), position: "end" });
    await sleep(400);
    assert.deepEqual(c.schemaErrors, []);
  }],
];

async function autoAdvance(c, [a, b]) {
  await subscribeAll(c);
  await c.call("player.play", { context: { kind: "tracks", ids: [a, b] } });
  const st = await c.waitEvent((e) => e.ev === "player.state" && e.p.track?.id === a, 20_000);
  await c.call("player.seek", { ms: Math.max(0, st.p.durMs - 3000) });
  const t0 = Date.now();
  const next = await c.waitEvent((e) => e.ev === "player.state" && e.p.track?.id === b, 10_000);
  assert.ok(Date.now() - t0 <= 10_000);
  assert.equal(next.p.track.id, b, "track becomes the second one within 10 s");
}
/** [yt2] alone with autoplay on: queue.changed total > 1 within 20 s of the end */
async function autoplayAtEnd(c, only) {
  await c.call("queue.setAutoplay", { on: true });
  await c.call("player.play", { context: { kind: "tracks", ids: [only] } });
  const st = await c.waitEvent((e) => e.ev === "player.state" && e.p.track?.id === only, 20_000);
  await c.call("player.seek", { ms: Math.max(0, st.p.durMs - 3000) });
  await c.waitEvent((e) => e.ev === "queue.changed", 20_000);
  const deadline = Date.now() + 20_000;
  let total = 1;
  while (Date.now() < deadline && total <= 1) { total = (await qw(c, 0, 1)).total; if (total <= 1) await sleep(500); }
  assert.ok(total > 1, `autoplay appended related tracks (total ${total})`);
  await c.call("queue.setAutoplay", { on: false });
}

export const mockOnly = [
  ["mock: player.play with album, playlist, artist and radio contexts", async (ctx) => {
    const c = await ui(ctx);
    const home = await c.call("home.get", {});
    const items = home.shelves.flatMap((s) => s.items);
    const alb = items.find((i) => i.t === "album");
    const pl = items.find((i) => i.t === "playlist");
    const ar = items.find((i) => i.t === "artist");
    for (const context of [{ kind: "album", id: alb.id }, { kind: "playlist", id: pl.id }, { kind: "artist", id: ar.id }, { kind: "radio", id: (await ids(c, 1))[0] }]) {
      await c.call("player.play", { context });
      assert.ok((await qw(c, 0, 1)).total >= 1, context.kind);
    }
  }],
  ["mock: auto-advance - seek to dur-3 s, the next track starts within 10 s", async (ctx) => {
    await autoAdvance(await ui(ctx), await ids(await ui(ctx), 2));
  }],
  ["mock: autoplay appends 5 related tracks when the queue ends", async (ctx) => {
    const c = await ui(ctx);
    await subscribeAll(c);
    const [only] = await ids(c, 1, 7);
    await autoplayAtEnd(c, only);
    assert.equal((await qw(c, 0, 1)).total, 6, "mock appends exactly 5");
  }],
  ["mock: queue.remove/move/select/clear/radio (queue pane support)", async (ctx) => {
    const c = await ui(ctx);
    const base = await ids(c, 6);
    await c.call("player.play", { context: { kind: "tracks", ids: base }, startIndex: 2 });
    let q = await qw(c);
    await c.call("queue.move", { from: 5, to: 0, expectedRevision: q.revision });
    assert.equal((await c.raw("queue.move", { from: 0, to: 1, expectedRevision: q.revision })).e?.code, "conflict");
    q = await qw(c);
    assert.equal(q.items[0].id, base[5]);
    assert.equal(q.items[q.currentIndex].id, base[2], "the current track keeps playing");
    await c.call("queue.remove", { qids: [q.items[0].qid] });
    q = await qw(c);
    assert.equal(q.total, 5);
    await c.call("queue.select", { qid: q.items[4].qid });
    assert.equal((await qw(c)).currentIndex, 4);
    await c.call("queue.clear", { keepCurrent: true });
    assert.equal((await qw(c)).total, 1);
    await c.call("queue.radio", { seedId: base[0] });
    assert.equal((await qw(c)).total, 25);
  }],
];

const LIVE = JSON.parse(readFileSync(join(here, "..", "fixtures", "live-ids.json"), "utf8"));
export const live = [
  ["player.play with a remote album and a playlist context (network)", async (ctx) => {
    const c = await ui(ctx);
    await c.call("player.play", { context: { kind: "album", id: LIVE.album.id } });
    assert.ok((await qw(c, 0, 1)).total >= 3, LIVE.album.url);
    await c.call("player.play", { context: { kind: "playlist", id: LIVE.playlist.id } });
    assert.ok((await qw(c, 0, 1)).total >= 10, LIVE.playlist.url);
    await c.call("player.play", { context: { kind: "artist", id: LIVE.artist.id } });
    assert.ok((await qw(c, 0, 1)).total >= 1, LIVE.artist.url);
  }],
  ["auto-advance: [yt1, yt2], seek to dur-3 s, the track becomes yt2 within 10 s", async (ctx) => {
    await autoAdvance(await ui(ctx), [LIVE.tracks[0].id, LIVE.tracks[1].id]);
  }],
  ["autoplay: [yt2] alone with autoplay on, queue.changed total > 1 within 20 s of the end", async (ctx) => {
    const c = await ui(ctx);
    await subscribeAll(c);
    await autoplayAtEnd(c, LIVE.tracks[1].id);
  }],
];
