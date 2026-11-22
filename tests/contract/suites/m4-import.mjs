// M4-4b import contract (api.md 3.12): providers, login, playlists, a run with import.progress events on `app`.
// Shape tests run on both targets; the sign-in/run flow needs a provider account, so it is mock-only (real: live, M4-4a).
import assert from "node:assert/strict";
import { Conn } from "../lib/conn.mjs";

async function ui(ctx) {
  const c = await Conn.connect(ctx);
  ctx.cleanup.push(() => c.close());
  return c;
}
const code = async (c, m, p) => (await c.raw(m, p, { validate: false })).e?.code;

export const tests = [
  ["providers: the five providers in order, each with a boolean signedIn", async (ctx) => {
    const c = await ui(ctx);
    const { items } = await c.call("import.providers");
    assert.deepEqual(items.map((i) => i.id), ["spotify", "tidal", "deezer", "apple", "amazon"]);
    for (const i of items) assert.equal(typeof i.signedIn, "boolean");
  }],
  ["unknown provider is bad_request", async (ctx) => {
    const c = await ui(ctx);
    assert.equal(await code(c, "import.playlists", { provider: "nope" }), "bad_request");
    assert.equal(await code(c, "import.login", { provider: "nope" }), "bad_request");
  }],
];

export const mockOnly = [
  ["playlists and run need a signed-in provider (not_signed_in)", async (ctx) => {
    const c = await ui(ctx);
    assert.equal(await code(c, "import.playlists", { provider: "amazon" }), "not_signed_in");
    assert.equal(await code(c, "import.run", { provider: "amazon", playlistIds: ["amazon-pl1"], target: "newUserAlbum" }), "not_signed_in");
  }],
  ["login -> playlists -> run: progress is monotonic, ends done+total with failed, result album exists", async (ctx) => {
    const c = await ui(ctx);
    await c.call("import.login", { provider: "tidal" });
    assert.equal((await c.call("import.providers")).items.find((i) => i.id === "tidal").signedIn, true);
    const { items } = await c.call("import.playlists", { provider: "tidal" });
    assert.ok(items.length >= 2);
    for (const i of items) { assert.equal(typeof i.title, "string"); assert.ok(Number.isInteger(i.count) && i.count > 0); }
    assert.equal(await code(c, "import.run", { provider: "tidal", playlistIds: [], target: "newUserAlbum" }), "bad_request");
    assert.equal(await code(c, "import.run", { provider: "tidal", playlistIds: [items[0].id], target: "lp:missing" }), "bad_request");
    await c.sub("app");
    const { jobId } = await c.call("import.run", { provider: "tidal", playlistIds: items.slice(0, 2).map((i) => i.id), target: "newUserAlbum" });
    const total = items[0].count + items[1].count;
    let last = 0;
    for (;;) {
      const e = await c.waitEvent((x) => x.ev === "import.progress" && x.p.jobId === jobId, 10000);
      assert.equal(e.p.total, total);
      assert.ok(e.p.done >= last && e.p.done <= total, "done is monotonic and <= total");
      assert.ok(e.p.failed <= e.p.done);
      last = e.p.done;
      if (e.p.done >= total) {
        assert.ok(Array.isArray(e.p.failedTracks) && e.p.failedTracks.length === e.p.failed);
        const ua = (await c.call("userAlbum.list")).items;
        assert.ok(ua.some((u) => u.id === e.p.albumId), "result album listed");
        break;
      }
    }
  }],
];
