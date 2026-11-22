// M4-2b downloads contract (api.md 3.9): summary/queue/window shapes, setFolder errors, the `downloads` topic, storage.usage/clear,
// import.files shape. The stateful queue flows (progress <= 2 Hz, failure + retry, pause, remove) run on the mock only;
// M4-2a must pass the shared tests on the real core (a real download needs the network, so real flows belong in `live`).
import assert from "node:assert/strict";
import { Conn } from "../lib/conn.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SORT = { by: "title", desc: false };
async function ui(ctx) {
  const c = await Conn.connect(ctx);
  ctx.cleanup.push(() => c.close());
  return c;
}
const code = async (c, m, p) => (await c.raw(m, p, { validate: false })).e?.code;
const until = async (fn, ms = 15000, step = 150) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("until: timeout");
    await sleep(step);
  }
};
/** songs that are not downloaded yet */
async function fresh(c, n, skip = 0) {
  const w = await c.call("library.window", { list: "songs", sort: { by: "added", desc: true }, filter: { downloaded: false }, offset: skip, limit: n });
  return w.items.map((t) => t.id);
}

export const tests = [
  ["download.summary: shape, byQuality sorted by count, folder is a string, folderOk boolean", async (ctx) => {
    const c = await ui(ctx);
    const s = await c.call("download.summary");
    assert.equal(typeof s.count, "number");
    assert.equal(typeof s.bytes, "number");
    assert.ok(s.folder.length > 0);
    assert.equal(typeof s.folderOk, "boolean");
    assert.equal(typeof s.paused, "boolean");
    assert.ok(s.active.total >= s.active.done);
    for (let i = 1; i < s.byQuality.length; i++) assert.ok(s.byQuality[i - 1].count >= s.byQuality[i].count, "byQuality sorted");
    assert.ok(s.byQuality.reduce((a, q) => a + q.count, 0) <= s.count);
  }],

  ["download.window: downloaded tracks only, windowed like library.window", async (ctx) => {
    const c = await ui(ctx);
    const w = await c.call("download.window", { list: "downloaded", sort: SORT, offset: 0, limit: 20 });
    assert.equal(typeof w.total, "number");
    assert.equal(typeof w.revision, "number");
    assert.ok(w.items.length <= 20 && w.items.every((t) => t.download === "downloaded" && t.id && t.title));
    const sum = await c.call("download.summary");
    assert.equal(w.total, sum.count, "window total equals summary count");
    assert.equal(await code(c, "download.window", { list: "downloaded", sort: SORT, offset: 0, limit: 500 }), "bad_request");
  }],

  ["download.queue: items are tracks with state, progress 0..1", async (ctx) => {
    const c = await ui(ctx);
    const { items } = await c.call("download.queue");
    for (const i of items) {
      assert.ok(["queued", "downloading", "failed", "downloaded", "none"].includes(i.state), i.state);
      assert.ok(i.progress >= 0 && i.progress <= 1);
      assert.ok(i.id && i.title);
    }
  }],

  ["download.setFolder: a missing folder is {ok:false,error:missing}; bad params are bad_request", async (ctx) => {
    const c = await ui(ctx);
    const r = await c.call("download.setFolder", { path: "Z:\\mm-contract-nonexistent\\folder" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "missing");
    assert.equal(await code(c, "download.setFolder", { path: "" }), "bad_request");
    assert.equal(await code(c, "download.setFolder", {}), "bad_request");
  }],

  ["download.remove without deleteFiles:true and download.cancel without ids/all are bad_request", async (ctx) => {
    const c = await ui(ctx);
    assert.equal(await code(c, "download.remove", { ids: ["x"] }), "bad_request");
    assert.equal(await code(c, "download.remove", { ids: ["x"], deleteFiles: false }), "bad_request");
    assert.equal(await code(c, "download.cancel", {}), "bad_request");
  }],

  ["download.tracks with an unknown id is not_found", async (ctx) => {
    const c = await ui(ctx);
    assert.equal(await code(c, "download.tracks", { ids: ["nope:nope"] }), "not_found");
  }],

  ["storage.usage: byte counts for every cache and the downloads, limits optional", async (ctx) => {
    const c = await ui(ctx);
    const u = await c.call("storage.usage");
    for (const k of ["songCache", "imageCache", "videoCache", "animatedArt", "downloads"]) assert.ok(Number.isFinite(u[k]) && u[k] >= 0, k);
    if (u.limits) for (const v of Object.values(u.limits)) assert.ok(Number.isFinite(v) && v >= 0);
    assert.equal(await code(c, "storage.clear", { what: "downloads" }), "bad_request");
  }],

  ["downloads topic: snapshot is a summary, pause/resume emit download.summary", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("downloads");
    const snap = await c.waitEvent((e) => e.ev === "downloads.snapshot");
    assert.equal(typeof snap.p.count, "number");
    await c.call("download.pause");
    const paused = await c.waitEvent((e) => e.ev === "download.summary" && e.p.paused === true);
    assert.equal(paused.p.paused, true);
    await c.call("download.resume");
    const resumed = await c.waitEvent((e) => e.ev === "download.summary" && e.p.paused === false);
    assert.equal(resumed.p.paused, false);
    assert.deepEqual(c.schemaErrors, []);
  }],

  ["import.files: {imported, failed} on success, or unsupported until the core lands it", async (ctx) => {
    const c = await ui(ctx);
    const m = await c.raw("import.files", { paths: [] }, { validate: false });
    if (m.e) assert.equal(m.e.code, "unsupported");
    else {
      assert.equal(typeof m.r.imported, "number");
      assert.equal(typeof m.r.failed, "number");
    }
    assert.equal(await code(c, "import.files", {}), "bad_request");
  }],
];

export const mockOnly = [
  ["setFolder rules: not_writable, null resets to the default, folderOk follows an unplugged drive", async (ctx) => {
    const c = await ui(ctx);
    assert.deepEqual(await c.call("download.setFolder", { path: "D:\\readonly\\x" }), { ok: false, error: "not_writable" });
    assert.deepEqual(await c.call("download.setFolder", { path: "D:\\Nhac\\MinMusic" }), { ok: true });
    assert.equal((await c.call("download.summary")).folder, "D:\\Nhac\\MinMusic");
    assert.deepEqual(await c.call("download.setFolder", { path: "E:\\offline\\Music" }), { ok: true });
    assert.equal((await c.call("download.summary")).folderOk, false);
    assert.deepEqual(await c.call("download.setFolder", { path: null }), { ok: true });
    const s = await c.call("download.summary");
    assert.equal(s.folderOk, true);
    assert.ok(s.folder.length > 0);
  }],

  ["download.tracks: queue fills, progress events <= 2 Hz per download, finished tracks land in the counts", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("downloads");
    await c.waitEvent((e) => e.ev === "downloads.snapshot");
    const before = await c.call("download.summary");
    const ids = await fresh(c, 3);
    assert.equal(ids.length, 3);
    await c.call("download.tracks", { ids });
    const q = await c.call("download.queue");
    assert.ok(q.items.length >= 1 && q.items.every((i) => ids.includes(i.id)));
    const t0 = Date.now();
    await until(async () => (await c.call("download.summary")).count > before.count, 20000);
    const per = new Map();
    for (const e of c.events.filter((x) => x.ev === "download.progress" && x.p.state === "downloading")) {
      assert.ok(e.p.progress >= 0 && e.p.progress <= 1);
      per.set(e.p.id, (per.get(e.p.id) ?? 0) + 1);
    }
    const secs = (Date.now() - t0) / 1000;
    for (const n of per.values()) assert.ok(n <= Math.ceil(secs * 2) + 2, `progress events per download: ${n} in ${secs.toFixed(1)} s`);
    assert.deepEqual(c.schemaErrors, []);
    await c.call("download.cancel", { all: true });
  }],

  ["failure then retry: a failing track is state failed with an error, retry completes it, remove deletes it", async (ctx) => {
    const c = await ui(ctx);
    // the mock fails every track whose id hashes to a multiple of 5 once: queue a pool until one fails
    await c.call("download.tracks", { ids: await fresh(c, 40, 3) });
    const failed = await until(async () => (await c.call("download.queue")).items.find((i) => i.state === "failed"), 90000, 300);
    assert.equal(failed.error, "network");
    await c.call("download.retry", { ids: [failed.id] });
    const back = (await c.call("download.queue")).items.find((i) => i.id === failed.id);
    assert.ok(back && back.state !== "failed");
    await until(async () => !(await c.call("download.queue")).items.some((i) => i.id === failed.id), 120000, 300);
    const q = { list: "downloaded", sort: SORT, offset: 0, limit: 200, filter: { text: failed.title } };
    assert.ok((await c.call("download.window", q)).items.some((t) => t.id === failed.id), "retried track is downloaded");
    await c.call("download.remove", { ids: [failed.id], deleteFiles: true });
    assert.ok(!(await c.call("download.window", q)).items.some((t) => t.id === failed.id), "removed");
    await c.call("download.cancel", { all: true });
    assert.equal((await c.call("download.queue")).items.length, 0);
  }],

  ["pause stops progress, cancel all empties the queue, download.context queues an album", async (ctx) => {
    const c = await ui(ctx);
    await c.call("download.cancel", { all: true });
    await c.call("download.tracks", { ids: await fresh(c, 4, 60) });
    await c.call("download.pause");
    const a = (await c.call("download.queue")).items.map((i) => i.progress);
    await sleep(900);
    const b = (await c.call("download.queue")).items.map((i) => i.progress);
    assert.deepEqual(a, b, "no progress while paused");
    assert.equal((await c.call("download.summary")).paused, true);
    await c.call("download.cancel", { all: true });
    assert.equal((await c.call("download.queue")).items.length, 0);
    const lib = await c.call("library.window", { list: "albums", sort: SORT, offset: 0, limit: 1 });
    await c.call("download.context", { context: { kind: "album", id: lib.items[0].id } });
    assert.ok((await c.call("download.queue")).items.length > 0, "album queued");
    await c.call("download.cancel", { all: true });
    await c.call("download.resume");
  }],

  ["storage.clear zeroes one cache and leaves the others", async (ctx) => {
    const c = await ui(ctx);
    const a = await c.call("storage.usage");
    assert.ok(a.imageCache > 0);
    await c.call("storage.clear", { what: "imageCache" });
    const b = await c.call("storage.usage");
    assert.equal(b.imageCache, 0);
    assert.equal(b.songCache, a.songCache);
  }],
];
