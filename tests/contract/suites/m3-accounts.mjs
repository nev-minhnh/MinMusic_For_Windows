// M3 accounts contract suite (api.md 3.11, 3.12): account.get, sources.*, the `account` topic, Last.fm / ListenBrainz / Discord status.
// `tests` are offline and must also pass on the real core (M3-2). Anything that needs a network login or a shell web-login window
// (NCT / Last.fm / Zing / YouTube / Discord login) is in `mockOnly`. Passwords are test strings only.
import assert from "node:assert/strict";
import { Conn } from "../lib/conn.mjs";

const IDS = ["yt", "sc", "zing", "nct"];
async function ui(ctx) {
  const c = await Conn.connect(ctx);
  ctx.cleanup.push(() => c.close());
  return c;
}
const items = async (c) => (await c.call("sources.list", {})).items;

export const tests = [
  ["account.get: signedIn is a boolean and youtube exists only when signed in", async (ctx) => {
    const c = await ui(ctx);
    const a = await c.call("account.get", {});
    assert.equal(typeof a.signedIn, "boolean");
    if (!a.signedIn) assert.equal(a.youtube, undefined);
    else assert.ok(a.youtube.name);
  }],

  ["sources.list: the four sources, a permutation as priority, status vocabulary, canLogin", async (ctx) => {
    const c = await ui(ctx);
    const r = await c.call("sources.list", {});
    const ids = r.items.map((i) => i.id);
    for (const id of IDS) assert.ok(ids.includes(id), `source ${id}`);
    assert.deepEqual([...r.priority].sort(), [...IDS].sort());
    for (const it of r.items) {
      assert.ok(["ok", "degraded", "off"].includes(it.status));
      assert.equal(typeof it.enabled, "boolean");
      assert.equal(typeof it.canLogin, "boolean");
      assert.ok(it.maxQuality.label);
    }
    assert.equal(r.items.find((i) => i.id === "sc").canLogin, false);
    assert.equal(r.items.find((i) => i.id === "nct").canLogin, true);
    assert.equal(typeof r.autoBest, "boolean");
    assert.equal(typeof r.autoFallback, "boolean");
  }],

  ["sources.setPriority: round-trips, rejects a non-permutation (bad_request); restored afterwards", async (ctx) => {
    const c = await ui(ctx);
    const before = (await c.call("sources.list", {})).priority;
    const next = [...before].reverse();
    try {
      await c.call("sources.setPriority", { order: next });
      assert.deepEqual((await c.call("sources.list", {})).priority, next);
      assert.equal((await c.raw("sources.setPriority", { order: ["yt", "yt", "zing", "nct"] })).e?.code, "bad_request");
      assert.equal((await c.raw("sources.setPriority", { order: ["yt"] })).e?.code, "bad_request");
      assert.deepEqual((await c.call("sources.list", {})).priority, next, "a rejected order changes nothing");
    } finally {
      await c.call("sources.setPriority", { order: before });
    }
  }],

  ["sources.setEnabled / setAutoBest / setAutoFallback persist; status off follows enabled=false; restored", async (ctx) => {
    const c = await ui(ctx);
    const r0 = await c.call("sources.list", {});
    const sc0 = r0.items.find((i) => i.id === "sc").enabled;
    try {
      await c.call("sources.setEnabled", { id: "sc", on: !sc0 });
      const sc = (await items(c)).find((i) => i.id === "sc");
      assert.equal(sc.enabled, !sc0);
      if (!sc.enabled) assert.equal(sc.status, "off");
      await c.call("sources.setAutoBest", { on: !r0.autoBest });
      await c.call("sources.setAutoFallback", { on: !r0.autoFallback });
      const r1 = await c.call("sources.list", {});
      assert.equal(r1.autoBest, !r0.autoBest);
      assert.equal(r1.autoFallback, !r0.autoFallback);
      assert.equal((await c.raw("sources.setEnabled", { id: "nope", on: true }, { validate: false })).e?.code, "bad_request");
    } finally {
      await c.call("sources.setEnabled", { id: "sc", on: sc0 });
      await c.call("sources.setAutoBest", { on: r0.autoBest });
      await c.call("sources.setAutoFallback", { on: r0.autoFallback });
    }
  }],

  ["account topic: snapshot first with account + sources, sources.changed follows a change", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("account");
    const snap = await c.waitEvent((e) => e.ev === "account.snapshot");
    assert.equal(typeof snap.p.account.signedIn, "boolean");
    assert.ok(Array.isArray(snap.p.sources.items));
    const on = snap.p.sources.autoBest;
    try {
      await c.call("sources.setAutoBest", { on: !on });
      const ev = await c.waitEvent((e) => e.ev === "sources.changed");
      assert.equal(ev.p.autoBest, !on);
    } finally {
      await c.call("sources.setAutoBest", { on });
    }
  }],

  ["lastfm.status / listenbrainz.status / discord.status answer when signed out", async (ctx) => {
    const c = await ui(ctx);
    const l = await c.call("lastfm.status", {});
    assert.equal(typeof l.expired, "boolean");
    assert.equal(typeof l.scrobbling, "boolean");
    assert.equal(typeof l.pending, "number");
    await c.call("listenbrainz.status", {});
    assert.equal(typeof (await c.call("discord.status", {})).enabled, "boolean");
  }],

  ["bad params: sources.setEnabled without id and nct.login without account are bad_request", async (ctx) => {
    const c = await ui(ctx);
    assert.equal((await c.raw("sources.setEnabled", { on: true }, { validate: false })).e?.code, "bad_request");
    assert.equal((await c.raw("source.nct.login", { password: "x" }, { validate: false })).e?.code, "bad_request");
  }],
];

export const mockOnly = [
  ["mock: NCT login with the password 'wrong' is unauthorized, 'offline' is network; a good login shows signed in + VIP", async (ctx) => {
    const c = await ui(ctx);
    const bad = await c.raw("source.nct.login", { account: "tester", password: "wrong" });
    assert.equal(bad.e?.code, "unauthorized");
    assert.ok(!JSON.stringify(bad).includes("wrong\""), "the password is not echoed");
    assert.equal((await c.raw("source.nct.login", { account: "offline", password: "pw-test" })).e?.code, "network");
    assert.ok(!(await items(c)).find((i) => i.id === "nct").signedIn, "a failed login leaves the source signed out");
    try {
      const r = await c.call("source.nct.login", { account: "vip.tester", password: "pw-test", phone: "0900000000", countryCode: "+84" });
      assert.deepEqual(r, { ok: true, vip: true });
      const nct = (await items(c)).find((i) => i.id === "nct");
      assert.equal(nct.signedIn, true);
      assert.equal(nct.vip, true);
      assert.equal(nct.maxQuality.label, "320");
      assert.ok(!JSON.stringify(nct).includes("pw-test"));
    } finally {
      await c.call("source.nct.logout", {});
    }
    const nct = (await items(c)).find((i) => i.id === "nct");
    assert.equal(nct.signedIn, false);
    assert.equal(nct.maxQuality.label, "128", "320 only with a VIP account");
  }],

  ["mock: a non-VIP NCT login keeps 128 kbps (no VIP bypass)", async (ctx) => {
    const c = await ui(ctx);
    try {
      assert.deepEqual(await c.call("source.nct.login", { account: "tester", password: "pw-test" }), { ok: true, vip: false });
      const nct = (await items(c)).find((i) => i.id === "nct");
      assert.equal(nct.vip, false);
      assert.equal(nct.maxQuality.label, "128");
    } finally {
      await c.call("source.nct.logout", {});
    }
  }],

  ["mock: web logins (YouTube, Zing) resolve after ~1.5 s and sources.changed / account.changed follow", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("account");
    await c.waitEvent((e) => e.ev === "account.snapshot");
    const t0 = Date.now();
    try {
      assert.deepEqual(await c.call("account.youtube.login", {}), { ok: true });
      assert.ok(Date.now() - t0 >= 1400, "web login takes about 1.5 s");
      const a = await c.call("account.get", {});
      assert.equal(a.signedIn, true);
      assert.ok(a.youtube.channels.length >= 2);
      await c.waitEvent((e) => e.ev === "account.changed" && e.p.signedIn);
      const name = a.youtube.name;
      await c.call("account.youtube.switchChannel", {});
      assert.notEqual((await c.call("account.get", {})).youtube.name, name);
      const z = await c.call("source.zing.login", {});
      assert.equal(z.ok, true);
      assert.equal(z.vip, false);
      assert.equal((await items(c)).find((i) => i.id === "zing").maxQuality.label, "128", "Zing 320 needs a VIP account");
    } finally {
      await c.call("source.zing.logout", {});
      await c.call("account.youtube.logout", {});
    }
    assert.equal((await c.call("account.get", {})).signedIn, false);
  }],

  ["mock: account.youtube.tokenLogin signs in; switchChannel while signed out is not_signed_in", async (ctx) => {
    const c = await ui(ctx);
    assert.equal((await c.raw("account.youtube.switchChannel", {})).e?.code, "not_signed_in");
    try {
      await c.call("account.youtube.tokenLogin", { cookie: "SID=test", visitorData: "vd-test" });
      assert.equal((await c.call("account.get", {})).signedIn, true);
    } finally {
      await c.call("account.youtube.logout", {});
    }
  }],

  ["mock: Last.fm login (wrong password = unauthorized), status, logout", async (ctx) => {
    const c = await ui(ctx);
    assert.equal((await c.raw("lastfm.login", { username: "tester", password: "wrong" })).e?.code, "unauthorized");
    assert.equal((await c.call("lastfm.status", {})).user, undefined);
    try {
      assert.deepEqual(await c.call("lastfm.login", { username: "tester", password: "pw-test" }), { ok: true, user: "tester" });
      const s = await c.call("lastfm.status", {});
      assert.equal(s.user, "tester");
      assert.equal(s.scrobbling, true);
      assert.ok(!JSON.stringify(s).includes("pw-test"));
    } finally {
      await c.call("lastfm.logout", {});
    }
    assert.equal((await c.call("lastfm.status", {})).user, undefined);
  }],

  ["mock: ListenBrainz token (bad = unauthorized, null clears) and Discord login", async (ctx) => {
    const c = await ui(ctx);
    assert.equal((await c.raw("listenbrainz.setToken", { token: "bad" })).e?.code, "unauthorized");
    try {
      await c.call("listenbrainz.setToken", { token: "tok-test" });
      assert.ok((await c.call("listenbrainz.status", {})).user);
      await c.call("discord.login", {});
      assert.deepEqual(await c.call("discord.status", {}), { user: "TestUser", enabled: true });
    } finally {
      await c.call("listenbrainz.setToken", { token: null });
      await c.call("discord.logout", {});
    }
    assert.equal((await c.call("listenbrainz.status", {})).user, undefined);
    assert.equal((await c.call("discord.status", {})).enabled, false);
  }],
];
