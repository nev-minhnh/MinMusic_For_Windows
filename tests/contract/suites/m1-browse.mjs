// M1 browse contract suite: home, charts, browse, moods, search, pages (album/artist/playlist/podcast/related), openUrl.
// Every method is called with schema-checked params and result (Conn.call validates both) plus one semantic assert each.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Conn } from "../lib/conn.mjs";
import { startTarget } from "../lib/target.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ui(ctx) {
  const c = await Conn.connect(ctx);
  ctx.cleanup.push(() => c.close());
  return c;
}
const items = (h) => h.shelves.flatMap((s) => s.items);

export const tests = [
  // ---------------------------------------------------------------- home
  ["home.get: chips; selecting a chip returns different shelves", async (ctx) => {
    const c = await ui(ctx);
    const base = await c.call("home.get", {});
    const chip = base.chips[0].key;
    const sel = await c.call("home.get", { chip });
    assert.deepEqual(sel.chips.filter((x) => x.selected).map((x) => x.key), [chip]);
    assert.notDeepEqual(sel.shelves.map((s) => s.key), base.shelves.map((s) => s.key));
    assert.ok(sel.shelves.length >= 3 && sel.shelves.every((s) => s.items.length > 0));
  }],
  ["home.more: 3 pages, then next:null", async (ctx) => {
    const c = await ui(ctx);
    let cursor = (await c.call("home.get", {})).next;
    assert.ok(cursor, "home.get has a next cursor");
    let pages = 0;
    const keys = new Set();
    while (cursor) {
      const r = await c.call("home.more", { cursor });
      pages++;
      assert.ok(r.shelves.length > 0);
      for (const s of r.shelves) { assert.ok(!keys.has(s.key), `shelf key repeats: ${s.key}`); keys.add(s.key); }
      cursor = r.next;
      assert.ok(pages <= 10, "pagination terminates");
    }
    assert.equal(pages, 3);
  }],

  // ---------------------------------------------------------------- charts, browse, moods
  ["charts.get: zing/nct/yt, 100 rows with rank, trend and delta", async (ctx) => {
    const c = await ui(ctx);
    for (const source of ["zing", "nct", "yt"]) {
      const ch = await c.call("charts.get", { source });
      assert.equal(ch.source, source);
      assert.equal(ch.items.length, 100);
      assert.deepEqual(ch.items.map((t) => t.rank), Array.from({ length: 100 }, (_, i) => i + 1));
      assert.ok(ch.items.every((t) => ["up", "down", "same", "new"].includes(t.trend)));
      assert.ok(ch.items.filter((t) => t.trend === "up" || t.trend === "down").every((t) => t.delta > 0));
      assert.ok(ch.tabs.length >= 2);
    }
    const a = await c.call("charts.get", { source: "zing", key: "us" });
    const b = await c.call("charts.get", { source: "zing", key: "kr" });
    assert.notEqual(a.items[0].id, b.items[0].id, "a tab selects different rows");
  }],
  ["moods.list + browse.page", async (ctx) => {
    const c = await ui(ctx);
    const m = await c.call("moods.list", {});
    assert.equal(m.items.length, 24);
    assert.equal(new Set(m.items.map((x) => x.key)).size, 24);
    const pg = await c.call("browse.page", { browseId: "FEmusic_moods_and_genres_category", params: m.items[0].key });
    assert.equal(pg.title, m.items[0].title);
    assert.ok(pg.shelves.length > 0 && pg.next === null);
    assert.equal((await c.raw("browse.page", { browseId: "" }, { validate: false })).e?.code, "bad_request");
  }],

  // ---------------------------------------------------------------- search
  ["search.suggest: <= 8 rows, ~120 ms latency", async (ctx) => {
    const c = await ui(ctx);
    const t0 = Date.now();
    const r = await c.call("search.suggest", { q: "son" });
    const dt = Date.now() - t0;
    assert.ok(dt >= 100, `latency ${dt} ms`);
    assert.ok(r.queries.length + r.items.length <= 8, "<= 8 rows in total");
    assert.ok(r.queries.length + r.items.length > 0);
  }],
  ["search.suggest cancellation: the first call answers `cancelled`", async (ctx) => {
    const c = await ui(ctx);
    const first = c.raw("search.suggest", { q: "s" });
    await sleep(20);
    const second = c.raw("search.suggest", { q: "so" });
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.e?.code, "cancelled");
    assert.ok(b.r, "the last call is answered");
  }],
  ["search.run: top with sources, sections, source and type filters", async (ctx) => {
    const c = await ui(ctx);
    const r = await c.call("search.run", { q: "sơn tùng" });
    assert.ok(r.top && Array.isArray(r.top.sources) && r.top.sources.length >= 1, "top has sources");
    assert.ok(r.sections.length >= 1);
    const trk = r.sections.find((s) => s.type === "track");
    assert.ok(trk && trk.items.every((i) => i.t === "track"));
    const onlyAlbums = await c.call("search.run", { q: "mua", type: "album" });
    assert.ok(onlyAlbums.sections.every((s) => s.type === "album"));
    const zing = await c.call("search.run", { q: "em", source: "zing", type: "track" });
    assert.ok(zing.sections.length > 0 && zing.sections[0].items.every((i) => i.source === "zing"));
    assert.equal((await c.raw("search.run", { q: "" }, { validate: false })).e?.code, "bad_request");
  }],
  ["search.run: cursor paging has 2 pages", async (ctx) => {
    const c = await ui(ctx);
    const p1 = await c.call("search.run", { q: "em", type: "track" });
    assert.ok(p1.next, "first page has a cursor");
    const p2 = await c.call("search.run", { q: "em", type: "track", cursor: p1.next });
    assert.equal(p2.next, null);
    const ids1 = new Set(p1.sections[0].items.map((i) => i.id));
    assert.ok(p2.sections[0].items.every((i) => !ids1.has(i.id)), "pages do not overlap");
  }],
  ["search.history: stateful list, remove one, clear", async (ctx) => {
    const c = await ui(ctx);
    await c.call("search.run", { q: "contract-history-probe" });
    let h = await c.call("search.history.list", {});
    assert.equal(h.items[0], "contract-history-probe", "latest search first");
    await c.call("search.history.remove", { q: "contract-history-probe" });
    h = await c.call("search.history.list", {});
    assert.ok(!h.items.includes("contract-history-probe"));
    await c.call("search.history.remove", {});
    assert.deepEqual((await c.call("search.history.list", {})).items, []);
  }],

  // ---------------------------------------------------------------- pages
  ["album.get: otherVersions and moreBy; unknown -> not_found", async (ctx) => {
    const c = await ui(ctx);
    const card = items(await c.call("home.get", {})).find((i) => i.t === "album");
    const a = await c.call("album.get", { id: card.id });
    assert.equal(a.album.id, card.id);
    assert.ok(Array.isArray(a.otherVersions));
    assert.ok(a.moreBy === undefined || a.moreBy.items.length > 0);
    assert.equal((await c.raw("album.get", { id: "nope" })).e?.code, "not_found");
  }],
  ["artist.get: 5 shelves; artist.about; artist.tracks cursor", async (ctx) => {
    const c = await ui(ctx);
    const w = await c.call("library.window", { list: "artists", sort: { by: "title", desc: false }, offset: 0, limit: 5 });
    const id = w.items[0].id;
    const a = await c.call("artist.get", { id });
    assert.deepEqual(a.shelves.map((s) => s.key), ["topSongs", "albums", "singles", "videos", "related"]);
    assert.equal(a.artist.id, id);
    assert.equal(typeof (await c.call("artist.about", { id })), "object");
    const t1 = await c.call("artist.tracks", { id });
    assert.ok(t1.items.length > 0);
    if (t1.next) {
      const t2 = await c.call("artist.tracks", { id, cursor: t1.next });
      assert.ok(t2.items.length > 0 && t2.items[0].id !== t1.items[0].id);
    }
    assert.equal((await c.raw("artist.get", { id: "nope" })).e?.code, "not_found");
  }],
  ["playlist.get: 300 tracks in pages of 100", async (ctx) => {
    const c = await ui(ctx);
    const pl = items(await c.call("home.get", {})).find((i) => i.t === "playlist");
    let r = await c.call("playlist.get", { id: pl.id });
    assert.equal(r.playlist.id, pl.id);
    const ids = [];
    let pages = 0;
    for (;;) {
      pages++;
      assert.equal(r.tracks.length, 100);
      ids.push(...r.tracks.map((t) => t.id));
      if (!r.next) break;
      r = await c.call("playlist.get", { id: pl.id, cursor: r.next });
      assert.ok(pages < 6);
    }
    assert.equal(pages, 3);
    assert.equal(new Set(ids).size, 300);
  }],
  ["podcast.get / podcast.episodes / related.get", async (ctx) => {
    const c = await ui(ctx);
    const p = await c.call("podcast.get", { id: "MPSPmock-podcast-1" });
    assert.ok(p.tracks.length > 0);
    const e = await c.call("podcast.episodes", { id: "MPSPmock-podcast-1" });
    assert.ok(e.items.length > 0);
    const w = await c.call("library.window", { list: "songs", sort: { by: "added", desc: true }, offset: 0, limit: 1 });
    const rel = await c.call("related.get", { trackId: w.items[0].id });
    assert.ok(rel.shelves.length > 0);
    assert.equal((await c.raw("related.get", { trackId: "nope" })).e?.code, "not_found");
  }],
  ["app.openUrl / app.copyLink", async (ctx) => {
    const c = await ui(ctx);
    const album = await c.call("app.openUrl", { url: "https://music.youtube.com/browse/MPREb_02D9VvpRQPT" });
    assert.deepEqual(album, { handled: true, nav: { route: "album", params: { id: "MPREb_02D9VvpRQPT" } } });
    const pl = await c.call("app.openUrl", { url: "https://music.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI" });
    assert.equal(pl.nav.route, "playlist");
    const ar = await c.call("app.openUrl", { url: "https://music.youtube.com/channel/UClyA28-01x4z60eWQ2kiNbA" });
    assert.equal(ar.nav.route, "artist");
    assert.equal((await c.call("app.openUrl", { url: "not a url" })).handled, false);
    const link = await c.call("app.copyLink", { id: "dQw4w9WgXcQ", kind: "song" });
    assert.match(link.url, /^https:\/\/music\.youtube\.com\/watch\?v=dQw4w9WgXcQ/);
    assert.equal((await c.raw("app.copyLink", { id: "zing:ZW1234", kind: "song" })).e?.code, "unsupported");
  }],
];

export const mockOnly = [];

// Live tests: real target with network only (skipped by --offline). Ids are in ../fixtures/live-ids.json.
const LIVE_IDS = JSON.parse(readFileSync(join(here, "..", "fixtures", "live-ids.json"), "utf8"));
export const live = [
  ["search.run \"sơn tùng\" returns sections with items", async (ctx) => {
    const c = await ui(ctx);
    const r = await c.call("search.run", { q: "sơn tùng" });
    assert.ok(r.sections.some((s) => s.items.length > 0));
  }],
  ["album.get on a stable official album id", async (ctx) => {
    const c = await ui(ctx);
    const a = await c.call("album.get", { id: LIVE_IDS.album.id });
    assert.ok(a.tracks.length >= 3, LIVE_IDS.album.url);
  }],
  ["artist.get on a stable official artist id", async (ctx) => {
    const c = await ui(ctx);
    const a = await c.call("artist.get", { id: LIVE_IDS.artist.id });
    assert.ok(a.shelves.length >= 2, LIVE_IDS.artist.url);
  }],
  ["playlist.get on a stable official playlist id", async (ctx) => {
    const c = await ui(ctx);
    const r = await c.call("playlist.get", { id: LIVE_IDS.playlist.id });
    assert.ok(r.tracks.length >= 10, LIVE_IDS.playlist.url);
  }],
  ["charts.get zing", async (ctx) => {
    const c = await ui(ctx);
    assert.ok((await c.call("charts.get", { source: "zing" })).items.length >= 10);
  }],
  ["home.get without a fixture (second core instance started without --fixture-home)", async (ctx) => {
    const t2 = await startTarget("real", { noFixture: true, testRoot: join(ctx.target.testRoot, "..", "contract-nofixture") });
    try {
      const c = await Conn.connect({ port: t2.port, token: t2.token });
      ctx.cleanup.push(() => c.close());
      const h = await c.call("home.get", {});
      assert.ok(h.shelves.length >= 1);
    } finally { await t2.stop(); }
  }],
];
