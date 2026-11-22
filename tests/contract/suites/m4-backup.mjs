// M4-3b backup contract (api.md 3.15): backup.create/inspect/restore, import.foreignBackup, crash.*, onboarding.*, app.logs.tail.
// Runs on the mock now; M4-3a must pass the same suite on the real core (the paths below do not exist on disk there, so the
// path-driven assertions are in mockOnly; `tests` holds what holds for both).
import assert from "node:assert/strict";
import { Conn } from "../lib/conn.mjs";

async function ui(ctx) {
  const c = await Conn.connect(ctx);
  ctx.cleanup.push(() => c.close());
  return c;
}
const code = async (c, m, p) => (await c.raw(m, p, { validate: false })).e?.code;

export const tests = [
  ["onboarding: complete is idempotent and the state reads as done afterwards", async (ctx) => {
    const c = await ui(ctx);
    await c.call("onboarding.complete");
    await c.call("onboarding.complete");
    const s = await c.call("onboarding.state");
    assert.ok(s.completed === true || s.firstRun === false, JSON.stringify(s));
  }],

  ["crash: pending has no report when none, dismiss is idempotent", async (ctx) => {
    const c = await ui(ctx);
    await c.call("crash.dismiss");
    await c.call("crash.dismiss");
    const r = await c.call("crash.pending");
    assert.equal(r.report, undefined);
  }],

  ["backup: an empty path is bad_request on every method", async (ctx) => {
    const c = await ui(ctx);
    for (const m of ["backup.create", "backup.inspect", "backup.restore", "import.foreignBackup"]) assert.equal(await code(c, m, { path: "" }), "bad_request", m);
  }],

  ["app.logs.tail: file and lines are validated, a small tail is text", async (ctx) => {
    const c = await ui(ctx);
    assert.equal(await code(c, "app.logs.tail", { file: "nope", lines: 10 }), "bad_request");
    assert.equal(await code(c, "app.logs.tail", { file: "app", lines: 2001 }), "bad_request");
    assert.equal(await code(c, "app.logs.tail", { file: "app", lines: 0 }), "bad_request");
    const r = await c.call("app.logs.tail", { file: "ui", lines: 5 });
    assert.equal(typeof r.text, "string");
  }],
];

export const mockOnly = [
  ["onboarding: reset firstRun -> completed false, complete -> true", async (ctx) => {
    const c = await ui(ctx);
    await c.raw("mock.onboarding.reset", { firstRun: true }, { validate: false });
    assert.equal((await c.call("onboarding.state")).completed, false);
    await c.call("onboarding.complete");
    assert.equal((await c.call("onboarding.state")).completed, true);
  }],

  ["crash: a raised report shows in pending, dismiss clears it", async (ctx) => {
    const c = await ui(ctx);
    await c.raw("mock.crash.raise", { summary: "boom" }, { validate: false });
    const r = (await c.call("crash.pending")).report;
    assert.equal(r.summary, "boom");
    assert.equal(typeof r.when, "number");
    assert.equal(typeof r.path, "string");
    await c.call("crash.dismiss");
    assert.equal((await c.call("crash.pending")).report, undefined);
  }],

  ["backup: create returns bytes, inspect ok / android / corrupt, restore stages a valid file and refuses a corrupt one", async (ctx) => {
    const c = await ui(ctx);
    const made = await c.call("backup.create", { path: "C:\\t\\b.zip" });
    assert.ok(made.bytes > 0);
    const ok = await c.call("backup.inspect", { path: "C:\\t\\b.zip" });
    assert.deepEqual([ok.ok, ok.platform, typeof ok.dbVersion, typeof ok.createdAt], [true, "desktop", "number", "number"]);
    assert.equal((await c.call("backup.inspect", { path: "C:\\t\\android.zip" })).platform, "android");
    const bad = await c.call("backup.inspect", { path: "C:\\t\\corrupt.zip" });
    assert.equal(bad.ok, false);
    assert.ok(bad.error);
    assert.deepEqual(await c.call("backup.restore", { path: "C:\\t\\b.zip" }), { staged: true });
    assert.equal(await code(c, "backup.restore", { path: "C:\\t\\corrupt.zip" }), "bad_request");
  }],

  ["import.foreignBackup: imported count, a corrupt file is bad_request", async (ctx) => {
    const c = await ui(ctx);
    assert.equal((await c.call("import.foreignBackup", { path: "C:\\t\\android.zip" })).imported, 42);
    assert.equal(await code(c, "import.foreignBackup", { path: "C:\\t\\corrupt.zip" }), "bad_request");
  }],

  ["app.logs.tail: exactly `lines` lines, the three levels present, files are tagged", async (ctx) => {
    const c = await ui(ctx);
    const t = (await c.call("app.logs.tail", { file: "app", lines: 2000 })).text;
    const lines = t.replace(/\n$/, "").split("\n");
    assert.equal(lines.length, 2000);
    for (const lv of ["INFO", "WARN", "ERROR"]) assert.ok(lines.some((l) => l.includes(` ${lv} `)), lv);
    const s = (await c.call("app.logs.tail", { file: "shell", lines: 20 })).text;
    assert.ok(s.includes("[shell]"));
  }],
];
