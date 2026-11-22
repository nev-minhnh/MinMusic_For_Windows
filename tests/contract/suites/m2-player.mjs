// M2 player suite (M2-2 owns it; M2-1 must pass the same suite on the real core): queue.*, player extras
// (sleep timer, output, mute, speed), lyrics.* and the queue / lyrics topics. Shapes are exact per api.md 3.6 / 3.7 / 4.
import assert from "node:assert/strict";
import { Conn } from "../lib/conn.mjs";

const SORT = { by: "added", desc: true };
async function ui(ctx) {
  const c = await Conn.connect(ctx);
  ctx.cleanup.push(() => c.close());
  return c;
}
/** play `n` library tracks (index `startIndex` current) and return their ids */
async function play(c, n = 6, startIndex = 0) {
  const w = await c.call("library.window", { list: "songs", sort: SORT, offset: 0, limit: 40 });
  const ids = w.items.slice(0, n).map((t) => t.id);
  await c.call("player.play", { context: { kind: "tracks", ids, title: "m2" }, startIndex });
  return ids;
}
const win = (c, offset = 0, limit = 100) => c.call("queue.window", { offset, limit });
const extra = async (c, k) => (await c.call("library.window", { list: "songs", sort: SORT, offset: 100, limit: k })).items.map((t) => t.id);

export const tests = [
  ["queue.window: total, revision, currentIndex, items with unique qid", async (ctx) => {
    const c = await ui(ctx);
    const ids = await play(c, 6, 2);
    const w = await win(c);
    assert.equal(w.total, 6);
    assert.equal(w.currentIndex, 2);
    assert.deepEqual(w.items.map((t) => t.id), ids);
    assert.equal(new Set(w.items.map((t) => t.qid)).size, 6);
    const part = await win(c, 4, 10);
    assert.deepEqual(part.items.map((t) => t.id), ids.slice(4));
    assert.equal((await c.raw("queue.window", { offset: 0, limit: 500 }, { validate: false })).e?.code, "bad_request");
  }],
  ["queue topic: snapshot {total, revision, currentIndex, head}; queue.changed on a change", async (ctx) => {
    const c = await ui(ctx);
    await play(c, 8, 3);
    await c.sub("queue");
    const snap = await c.waitEvent((e) => e.ev === "queue.snapshot");
    assert.equal(snap.p.total, 8);
    assert.equal(snap.p.currentIndex, 3);
    assert.ok(snap.p.head.length >= 6 && snap.p.head.every((t) => typeof t.qid === "string"));
    assert.equal(snap.p.head[0].qid, (await win(c)).items[0].qid, "head starts at current-5 (clamped to 0)");
    const [x] = await extra(c, 1);
    const { revision } = await c.call("queue.add", { ids: [x], position: "end" });
    const ch = await c.waitEvent((e) => e.ev === "queue.changed");
    assert.equal(ch.p.revision, revision);
    assert.equal(ch.p.currentIndex, 3);
  }],
  ["queue.add: next / end / index; revision grows; currentIndex follows insertions before it", async (ctx) => {
    const c = await ui(ctx);
    const ids = await play(c, 5, 2);
    const [a, b, d] = await extra(c, 3);
    const r0 = (await win(c)).revision;
    const r1 = (await c.call("queue.add", { ids: [a], position: "next" })).revision;
    assert.ok(r1 > r0);
    let w = await win(c);
    assert.equal(w.items[3].id, a);
    assert.equal(w.currentIndex, 2);
    await c.call("queue.add", { ids: [b], position: "end" });
    w = await win(c);
    assert.equal(w.items.at(-1).id, b);
    await c.call("queue.add", { ids: [d], position: 0 });
    w = await win(c);
    assert.equal(w.items[0].id, d);
    assert.equal(w.currentIndex, 3, "inserted before the current item");
    assert.equal(w.items[w.currentIndex].id, ids[2]);
    assert.equal((await c.raw("queue.add", { ids: ["nope"], position: "end" })).e?.code, "not_found");
  }],
  ["queue.addContext: appends a whole album at the end", async (ctx) => {
    const c = await ui(ctx);
    await play(c, 3);
    const h = await c.call("home.get", {});
    const alb = h.shelves.flatMap((s) => s.items).find((i) => i.t === "album");
    const { revision } = await c.call("queue.addContext", { context: { kind: "album", id: alb.id }, position: "end" });
    const w = await win(c);
    assert.ok(w.total > 3);
    assert.equal(w.revision, revision);
  }],
  ["queue.remove: other items, the playing item (index stays valid), unknown qid is a no-op", async (ctx) => {
    const c = await ui(ctx);
    const ids = await play(c, 6, 3);
    let w = await win(c);
    await c.call("queue.remove", { qids: [w.items[0].qid, w.items[1].qid] });
    w = await win(c);
    assert.equal(w.total, 4);
    assert.equal(w.currentIndex, 1, "two items before the current one are gone");
    assert.equal(w.items[1].id, ids[3]);
    await c.call("queue.remove", { qids: ["q-unknown"] });
    assert.equal((await win(c)).total, 4);
    await c.call("queue.remove", { qids: [w.items[1].qid] });
    w = await win(c);
    assert.equal(w.total, 3);
    assert.ok(w.currentIndex >= 0 && w.currentIndex < 3);
  }],
  ["queue.move: reorders, keeps the current item, stale expectedRevision -> conflict", async (ctx) => {
    const c = await ui(ctx);
    const ids = await play(c, 6, 1);
    const w = await win(c);
    await c.call("queue.move", { from: 4, to: 2, expectedRevision: w.revision });
    const m = await win(c);
    assert.deepEqual(m.items.map((t) => t.id), [ids[0], ids[1], ids[4], ids[2], ids[3], ids[5]]);
    assert.equal(m.currentIndex, 1);
    assert.ok(m.revision > w.revision);
    await c.call("queue.move", { from: 0, to: 3, expectedRevision: m.revision });
    assert.equal((await win(c)).currentIndex, 0, "moving an item over the current one shifts the index");
    assert.equal((await c.raw("queue.move", { from: 1, to: 2, expectedRevision: w.revision })).e?.code, "conflict");
  }],
  ["queue.select: starts that item; player.state follows", async (ctx) => {
    const c = await ui(ctx);
    const ids = await play(c, 6, 0);
    await c.sub("player");
    await c.waitEvent((e) => e.ev === "player.snapshot");
    const w = await win(c);
    await c.call("queue.select", { qid: w.items[4].qid });
    const st = await c.waitEvent((e) => e.ev === "player.state" && e.p.track?.id === ids[4]);
    assert.equal(st.p.playing, true);
    assert.equal((await win(c)).currentIndex, 4);
    assert.equal((await c.raw("queue.select", { qid: "q-none" })).e?.code, "not_found");
  }],
  ["queue.clear keepCurrent: only the playing item stays", async (ctx) => {
    const c = await ui(ctx);
    const ids = await play(c, 6, 3);
    await c.call("queue.clear", { keepCurrent: true });
    const w = await win(c);
    assert.equal(w.total, 1);
    assert.equal(w.currentIndex, 0);
    assert.equal(w.items[0].id, ids[3]);
  }],
  ["queue.setAutoplay: at the end of the queue more tracks are appended", async (ctx) => {
    const c = await ui(ctx);
    await play(c, 2, 1);
    await c.call("queue.setAutoplay", { on: true });
    await c.call("player.next", {});
    const w = await win(c);
    assert.ok(w.total > 2, "autoplay appended related tracks");
    await c.call("queue.setAutoplay", { on: false });
  }],
  ["queue.radio: replaces the queue with the seed first", async (ctx) => {
    const c = await ui(ctx);
    const [seed] = await play(c, 3);
    await c.call("queue.radio", { seedId: seed });
    const w = await win(c);
    assert.ok(w.total >= 10);
    assert.equal(w.items[w.currentIndex].id, seed);
  }],

  // ---------------------------------------------------------------- player extras
  ["player.mute / setSpeed show up in player.state", async (ctx) => {
    const c = await ui(ctx);
    await play(c, 3);
    await c.sub("player");
    await c.waitEvent((e) => e.ev === "player.snapshot");
    await c.call("player.mute", { on: true });
    assert.equal((await c.waitEvent((e) => e.ev === "player.state" && e.p.muted === true)).p.muted, true);
    await c.call("player.mute", { on: false });
    await c.waitEvent((e) => e.ev === "player.state" && e.p.muted === false);
    await c.call("player.setSpeed", { speed: 1.5 });
    assert.equal((await c.waitEvent((e) => e.ev === "player.state" && e.p.speed === 1.5)).p.speed, 1.5);
    await c.call("player.setSpeed", { speed: 1 });
  }],
  ["player.sleepTimer: minutes -> deadline in the future; cancel and endOfTrack are accepted", async (ctx) => {
    const c = await ui(ctx);
    await play(c, 3);
    const r = await c.call("player.sleepTimer", { minutes: 15 });
    assert.ok(typeof r.deadline === "number" && r.deadline > Date.now() + 14 * 60_000 && r.deadline < Date.now() + 16 * 60_000);
    await c.call("player.sleepTimer", { endOfTrack: true });
    await c.call("player.sleepTimer", { cancel: true });
  }],
  ["player.output.list / set: current is one of the devices", async (ctx) => {
    const c = await ui(ctx);
    const r = await c.call("player.output.list", {});
    assert.ok(r.devices.length >= 1);
    assert.ok(r.devices.some((d) => d.id === r.current));
    assert.ok(r.devices.every((d) => typeof d.name === "string" && ["speaker", "wired", "bluetooth", "usb", "other"].includes(d.kind) && typeof d.default === "boolean"));
    await c.call("player.output.set", { id: r.devices[0].id });
  }],

  // ---------------------------------------------------------------- lyrics
  ["lyrics.get: shape; times ascending; word synced words stay inside their line", async (ctx) => {
    const c = await ui(ctx);
    const ids = await play(c, 4);
    for (const id of ids) {
      const ly = await c.call("lyrics.get", { trackId: id });
      assert.equal(ly.trackId, id);
      assert.ok(["word", "line", "none"].includes(ly.synced));
      assert.equal(typeof ly.offsetMs, "number");
      assert.ok(ly.lines.length >= 3);
      for (let i = 1; i < ly.lines.length; i++) assert.ok(ly.lines[i].t >= ly.lines[i - 1].t, "ascending");
      if (ly.synced === "word") {
        for (const l of ly.lines) {
          assert.ok(l.words?.length > 0);
          assert.ok(l.words[0].t >= l.t - 1 && l.words.at(-1).end <= (l.end ?? Infinity) + 1);
          assert.equal(l.words.map((w) => w.text).join("").trim(), l.text);
        }
      }
    }
  }],
  ["lyrics topic: snapshot is the current track's lyrics; choose / offset / translate / romanize push lyrics.updated", async (ctx) => {
    const c = await ui(ctx);
    const [id] = await play(c, 3);
    await c.sub("lyrics");
    const snap = await c.waitEvent((e) => e.ev === "lyrics.snapshot");
    assert.equal(snap.p.trackId, id);
    const s = await c.call("lyrics.search", { trackId: id });
    assert.ok(s.candidates.length >= 2);
    const word = s.candidates.find((x) => x.synced === "word");
    const line = s.candidates.find((x) => x.synced === "line");
    assert.ok(word && line);
    await c.call("lyrics.choose", { trackId: id, candidateId: word.id });
    assert.equal((await c.waitEvent((e) => e.ev === "lyrics.updated")).p.synced, "word");
    await c.call("lyrics.choose", { trackId: id, candidateId: line.id });
    assert.equal((await c.waitEvent((e) => e.ev === "lyrics.updated")).p.synced, "line");
    await c.call("lyrics.setOffset", { trackId: id, ms: 250 });
    assert.equal((await c.waitEvent((e) => e.ev === "lyrics.updated")).p.offsetMs, 250);
    await c.call("lyrics.translate", { trackId: id, on: true, target: "en" });
    const tr = await c.waitEvent((e) => e.ev === "lyrics.updated" && e.p.lines.some((l) => l.tr));
    assert.ok(tr.p.lines.every((l) => typeof l.tr === "string"));
    await c.call("lyrics.romanize", { trackId: id, on: true });
    await c.waitEvent((e) => e.ev === "lyrics.updated" && e.p.lines.some((l) => l.ro));
    await c.call("lyrics.translate", { trackId: id, on: false });
    await c.call("lyrics.romanize", { trackId: id, on: false });
    await c.call("lyrics.setOffset", { trackId: id, ms: 0 });
  }],
  ["lyrics.edit accepts LRC text", async (ctx) => {
    const c = await ui(ctx);
    const [id] = await play(c, 2);
    await c.call("lyrics.edit", { trackId: id, lrc: "[00:01.00]xin chao\n[00:05.00]tam biet" });
  }],
];
