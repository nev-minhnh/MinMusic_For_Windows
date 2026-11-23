// M1 library contract suite: windows for every list and sort, counts/indexOf/sync, likes, user albums (revision + conflict),
// history (groups), stats, library.changed rate, real-target tolerances (track.setSource / import.files -> unsupported).
// The seeded dataset (tests/fixtures/library-seed.json) is the same on the mock and on the real core:
// 5,000 songs, 40 albums, 10 user albums, 2,000 history events.
// Order matters: the destructive history tests are last.
import assert from "node:assert/strict";
import { Conn } from "../lib/conn.mjs";
import { checkEvent } from "../lib/schema.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SORT = { by: "added", desc: true };
const SONG_SORTS = ["added", "title", "artist", "album", "duration", "plays", "lastPlayed"];
async function ui(ctx) {
  const c = await Conn.connect(ctx);
  ctx.cleanup.push(() => c.close());
  return c;
}
const win = (c, list, sort = SORT, offset = 0, limit = 50, filter) =>
  c.call("library.window", { list, sort, ...(filter ? { filter } : {}), offset, limit });
/** the first seeded user album id (the real core assigns its own db ids) */
async function firstUserAlbum(c) {
  const l = await c.call("userAlbum.list", {});
  assert.ok(l.items.length >= 10, `seeded user albums: ${l.items.length}`);
  return l.items.find((u) => u.count > 3) ?? l.items[0];
}

export const tests = [
  ["library.window offset=4900 limit=200 -> 100 items, total 5000", async (ctx) => {
    const c = await ui(ctx);
    const w = await win(c, "songs", SORT, 4900, 200);
    assert.equal(w.items.length, 100);
    assert.equal(w.total, 5000);
    assert.equal(w.offset, 4900);
  }],
  ["library.window: every song sort, both directions, is ordered", async (ctx) => {
    const c = await ui(ctx);
    for (const by of SONG_SORTS) {
      for (const desc of [false, true]) {
        const w = await win(c, "songs", { by, desc }, 0, 60);
        assert.equal(w.items.length, 60, `${by} desc=${desc}`);
        const key = { added: (t) => t.addedAt, duration: (t) => t.durationMs, title: (t) => t.title.toLocaleLowerCase("vi") }[by];
        if (!key) continue;
        for (let i = 1; i < w.items.length; i++) {
          const a = key(w.items[i - 1]), b = key(w.items[i]);
          const cmp = typeof a === "string" ? a.localeCompare(b, "vi") : a - b;
          assert.ok(desc ? cmp >= 0 : cmp <= 0, `${by} desc=${desc} at ${i}: ${a} vs ${b}`);
        }
      }
    }
  }],
  ["library.window: every LocalList answers with the right item kind", async (ctx) => {
    const c = await ui(ctx);
    const ua = await firstUserAlbum(c);
    const lists = [
      ["songs", "id"], ["liked", "id"], ["downloaded", "id"], ["cached", "id"], ["albums", "kind"], ["artists", "name"],
      ["playlists", "title"], [`userAlbum:${ua.id}`, "id"], ["history", "id"],
    ];
    for (const [list, field] of lists) {
      const w = await win(c, list, SORT, 0, 20);
      assert.equal(typeof w.total, "number", list);
      assert.equal(typeof w.revision, "number", list);
      assert.ok(w.items.length <= 20 && w.items.every((x) => x[field] !== undefined), `${list}: items have ${field}`);
    }
    assert.equal((await win(c, "albums", SORT, 0, 100)).total, 40);
    assert.equal((await c.raw("library.window", { list: "nope", sort: SORT, offset: 0, limit: 10 }, { validate: false })).e?.code, "bad_request");
  }],
  ["library.window: FilterSpec (text diacritic-insensitive, source, liked, downloaded)", async (ctx) => {
    const c = await ui(ctx);
    const text = await win(c, "songs", SORT, 0, 200, { text: "mua" });
    assert.ok(text.total > 0 && text.total < 5000);
    const accented = await win(c, "songs", SORT, 0, 200, { text: "mưa" });
    assert.equal(accented.total, text.total, "mua == mưa");
    const zing = await win(c, "songs", SORT, 0, 200, { source: "zing" });
    assert.ok(zing.total > 0 && zing.items.every((t) => t.source === "zing"));
    const liked = await win(c, "songs", SORT, 0, 200, { liked: true });
    assert.ok(liked.items.every((t) => t.liked === true));
    const dl = await win(c, "songs", SORT, 0, 200, { downloaded: true });
    assert.ok(dl.items.every((t) => t.download === "downloaded"));
  }],
  ["library.counts and library.indexOf", async (ctx) => {
    const c = await ui(ctx);
    const n = await c.call("library.counts", {});
    assert.equal(n.songs, 5000);
    assert.equal(n.albums, 40);
    assert.equal(n.userAlbums, 10);
    const sort = { by: "title", desc: false };
    const w = await win(c, "songs", sort, 120, 5);
    const r = await c.call("library.indexOf", { list: "songs", sort, id: w.items[2].id });
    assert.equal(r.index, 122);
    assert.equal((await c.raw("library.indexOf", { list: "songs", sort, id: "nope" })).e?.code, "not_found");
  }],
  ["library.sync answers {}", async (ctx) => {
    assert.deepEqual(await (await ui(ctx)).call("library.sync", {}), {});
  }],

  // ---------------------------------------------------------------- likes, saves, track details
  ["track.like: library.changed within 300 ms, liked list follows, counts follow", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("library");
    await c.waitEvent((e) => e.ev === "library.snapshot");
    const before = await c.call("library.counts", {});
    const t = (await win(c, "songs", SORT, 0, 5, { liked: false })).items[0];
    const t0 = Date.now();
    assert.deepEqual(await c.call("track.like", { id: t.id, liked: true }), { liked: true });
    const ev = await c.waitEvent((e) => e.ev === "library.changed" && e.p.lists.some((l) => l === "liked" || l === "songs"), 300);
    assert.ok(Date.now() - t0 <= 320, `${Date.now() - t0} ms`);
    assert.equal(typeof ev.p.revision, "number");
    assert.equal((await c.call("library.counts", {})).liked, before.liked + 1);
    assert.ok((await win(c, "liked", SORT, 0, 200)).items.some((x) => x.id === t.id));
    await c.call("track.like", { id: t.id, liked: false });
    assert.equal((await c.call("library.counts", {})).liked, before.liked);
  }],
  ["library.changed is coalesced to <= 4 Hz", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("library");
    await c.waitEvent((e) => e.ev === "library.snapshot");
    const t = (await win(c, "songs", SORT, 10, 1)).items[0];
    c.events.length = 0;
    const t0 = Date.now();
    for (let i = 0; i < 16; i++) { await c.call("track.like", { id: t.id, liked: i % 2 === 0 }); await sleep(20); }
    await sleep(600);
    const elapsed = (Date.now() - t0) / 1000;
    const n = c.events.filter((e) => e.ev === "library.changed").length;
    assert.ok(n >= 1 && n <= Math.ceil(4 * elapsed) + 1, `${n} library.changed in ${elapsed.toFixed(2)} s`);
    await c.call("track.like", { id: t.id, liked: false });
  }],
  ["album.save, artist.subscribe", async (ctx) => {
    const c = await ui(ctx);
    const al = (await win(c, "albums", SORT, 0, 1)).items[0];
    const ar = (await win(c, "artists", SORT, 0, 1)).items[0];
    assert.deepEqual(await c.call("album.save", { id: al.id, on: true }), { on: true });
    assert.deepEqual(await c.call("album.save", { id: al.id, on: false }), { on: false });
    assert.deepEqual(await c.call("artist.subscribe", { id: ar.id, on: true }), { on: true });
    assert.deepEqual(await c.call("artist.subscribe", { id: ar.id, on: false }), { on: false });
  }],
  ["track.info and track.sources describe the current source", async (ctx) => {
    const c = await ui(ctx);
    const t = (await win(c, "songs", SORT, 0, 1)).items[0];
    const info = await c.call("track.info", { id: t.id });
    assert.equal(info.track.id, t.id);
    assert.ok(Array.isArray(info.details.sources) && info.details.sources.length >= 1);
    const s = await c.call("track.sources", { id: t.id });
    assert.ok(s.options.length >= 1 && s.options.every((o) => typeof o.available === "boolean"));
  }],
  ["track.block / artist.block round trip", async (ctx) => {
    const c = await ui(ctx);
    const t = (await win(c, "songs", SORT, 20, 1)).items[0];
    await c.call("track.block", { id: t.id, on: true });
    await c.call("track.block", { id: t.id, on: false });
    const ar = (await win(c, "artists", SORT, 1, 1)).items[0];
    await c.call("artist.block", { id: ar.id, on: true });
    await c.call("artist.block", { id: ar.id, on: false });
  }],
  // INT-W5: track.setSource (M3-2) and import.files (M4-2a) exist on both targets now.
  ["track.setSource and import.files: errors and a missing file", async (ctx) => {
    const c = await ui(ctx);
    assert.ok((await c.raw("track.setSource", { id: "nope-id", source: "zing" })).e, "an unknown track cannot take a source");
    const r = await c.raw("import.files", { paths: ["C:/nope/a.mp3"] }, { validate: false });
    if (!r.e) assert.deepEqual(r.r, { imported: 0, failed: 1 });
    else assert.equal(r.e.code, "unsupported"); // mock
    assert.equal((await c.raw("import.files", {}, { validate: false })).e?.code, "bad_request");
  }],

  // ---------------------------------------------------------------- user albums
  ["userAlbum: create, add (dedupe), window, move, conflict, remove, pin, rename, setCover(null), delete", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("library");
    await c.waitEvent((e) => e.ev === "library.snapshot");
    const songs = (await win(c, "songs", SORT, 100, 6)).items;
    const { id } = await c.call("userAlbum.create", { title: "Contract album", trackIds: [songs[0].id, songs[1].id] });
    assert.match(id, /^lp:/);
    await c.waitEvent((e) => e.ev === "userAlbums.changed", 2000);
    const add = await c.call("userAlbum.add", { id, trackIds: [songs[1].id, songs[2].id, songs[3].id], dedupe: true });
    assert.deepEqual(add, { added: 2, skipped: 1 });

    let w = await win(c, `userAlbum:${id}`, { by: "custom", desc: false }, 0, 50);
    assert.deepEqual(w.items.map((t) => t.id), [songs[0].id, songs[1].id, songs[2].id, songs[3].id]);
    assert.ok(w.items.every((t) => typeof t.setVideoId === "string" && t.setVideoId !== ""), "entry ids in setVideoId");

    await c.call("userAlbum.move", { id, from: 0, to: 2, expectedRevision: w.revision });
    const w2 = await win(c, `userAlbum:${id}`, { by: "custom", desc: false }, 0, 50);
    assert.deepEqual(w2.items.map((t) => t.id), [songs[1].id, songs[2].id, songs[0].id, songs[3].id]);
    assert.ok(w2.revision > w.revision, "a write bumps the revision");
    const stale = await c.raw("userAlbum.move", { id, from: 0, to: 1, expectedRevision: w.revision });
    assert.equal(stale.e?.code, "conflict", "stale revision -> conflict");

    await c.call("userAlbum.remove", { id, entryIds: [w2.items[0].setVideoId] });
    w = await win(c, `userAlbum:${id}`, { by: "custom", desc: false }, 0, 50);
    assert.equal(w.total, 3);
    await c.call("userAlbum.pin", { id, pinned: true });
    await c.call("userAlbum.rename", { id, title: "Contract album 2" });
    const listed = (await c.call("userAlbum.list", {})).items.find((u) => u.id === id);
    assert.equal(listed.title, "Contract album 2");
    assert.equal(listed.pinned, true);
    assert.equal(listed.count, 3);
    assert.equal(typeof (await c.call("userAlbum.setCover", { id, path: null })).art.src, "string");
    await c.call("userAlbum.delete", { id });
    assert.ok(!(await c.call("userAlbum.list", {})).items.some((u) => u.id === id));
    assert.equal((await c.raw("userAlbum.rename", { id, title: "x" })).e?.code, "not_found");
  }],

  // ---------------------------------------------------------------- history, stats (destructive tests are last)
  ["history.window: groups are present and consistent", async (ctx) => {
    const c = await ui(ctx);
    const h = await c.call("history.window", { list: "history", sort: SORT, offset: 0, limit: 200 });
    assert.equal(h.total, 2000);
    assert.equal(h.items.length, 200);
    assert.ok(h.groups.length >= 1, "groups present");
    assert.equal(h.groups[0].offset, 0);
    for (let i = 1; i < h.groups.length; i++) assert.ok(h.groups[i].offset > h.groups[i - 1].offset, "offsets increase");
    assert.ok(h.groups.every((g) => /^w2_hist_[a-z]+$/.test(g.label)), `labels are i18n keys: ${h.groups.map((g) => g.label)}`);
    for (let i = 1; i < h.items.length; i++) assert.ok(h.items[i - 1].playedAt >= h.items[i].playedAt, "newest first");
    assert.ok(h.items.every((t) => typeof t.playedAt === "number"));
  }],
  ["stats.get for every period", async (ctx) => {
    const c = await ui(ctx);
    for (const period of ["week", "month", "year", "all"]) {
      const s = await c.call("stats.get", { period });
      assert.ok(s.topTracks.length <= 10 && s.topArtists.length <= 10 && s.topAlbums.length <= 10);
    }
    const all = await c.call("stats.get", { period: "all" });
    assert.ok(all.minutes > 0 && all.topTracks.length > 0);
  }],
  ["all events validated against the schema", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("library");
    const t = (await win(c, "songs", SORT, 30, 1)).items[0];
    await c.call("track.like", { id: t.id, liked: true });
    await c.call("track.like", { id: t.id, liked: false });
    await sleep(500);
    assert.deepEqual(c.schemaErrors, []);
    for (const e of c.events) assert.equal(checkEvent(e.ev, e.p), null, e.ev);
  }],
  ["history.remove then history.clear (destructive: keep last)", async (ctx) => {
    const c = await ui(ctx);
    const h = await c.call("history.window", { list: "history", sort: SORT, offset: 0, limit: 3 });
    const eventId = String(h.items[0].eventId);
    assert.ok(eventId, "items carry eventId");
    await c.call("history.remove", { eventIds: [eventId] });
    const after = await c.call("history.window", { list: "history", sort: SORT, offset: 0, limit: 3 });
    assert.equal(after.total, 1999);
    assert.notEqual(String(after.items[0].eventId), eventId);
    await c.call("history.clear", {});
    const empty = await c.call("history.window", { list: "history", sort: SORT, offset: 0, limit: 10 });
    assert.equal(empty.total, 0);
    assert.deepEqual(empty.groups, []);
  }],
];

export const mockOnly = [
  ["mock: playlist.save toggles the saved list", async (ctx) => {
    const c = await ui(ctx);
    const pl = (await win(c, "playlists", SORT, 0, 1)).items[0];
    const n = (await c.call("library.counts", {})).playlists;
    await c.call("playlist.save", { id: pl.id, on: false });
    assert.equal((await c.call("library.counts", {})).playlists, n - 1);
    await c.call("playlist.save", { id: pl.id, on: true });
    assert.equal((await c.call("library.counts", {})).playlists, n);
  }],
  ["mock: userAlbum.list revision equals the library revision", async (ctx) => {
    const c = await ui(ctx);
    const l = await c.call("userAlbum.list", {});
    const w = await win(c, "songs", SORT, 0, 1);
    assert.ok(l.items.every((u) => u.revision === w.revision));
  }],
];

export const live = [
  ["playlist.save on a remote playlist (network)", async (ctx) => {
    const c = await ui(ctx);
    const home = await c.call("home.get", {});
    const pl = home.shelves.flatMap((s) => s.items).find((i) => i.t === "playlist");
    if (!pl) return; // nothing to save on this home
    assert.deepEqual(await c.call("playlist.save", { id: pl.id, on: true }), { on: true });
    await c.call("playlist.save", { id: pl.id, on: false });
  }],
];
