// M3-4b contract for Device Connect (api.md 3.14) and Listen Together (3.13): state shapes, the link/QR contract, pairing with SAS,
// the LT room lifecycle. `tests` run on both targets (no network, no peer needed); `mockOnly` need the mock's `mock.dc.*` / `mock.lt.*`
// hooks or a reachable LT server. M3-4a must pass `tests` on the real core.
import assert from "node:assert/strict";
import { Conn } from "../lib/conn.mjs";

async function ui(ctx) {
  const c = await Conn.connect(ctx);
  ctx.cleanup.push(() => c.close());
  return c;
}
const code = async (c, m, p) => (await c.raw(m, p, { validate: false })).e?.code;
const hook = async (c, m, p) => (await c.raw(m, p, { validate: false })).r;
const LINK = /^metrolist:\/\/device-connect\?a=[^&]+&n=.+$/;

async function dcOff(c) {
  await c.call("dc.enable", { on: false });
}
async function ltIdle(c) {
  await c.call("lt.leave");
}

export const tests = [
  ["dc.state: shape; disabled has no link and no QR", async (ctx) => {
    const c = await ui(ctx);
    await dcOff(c);
    const s = await c.call("dc.state");
    assert.equal(s.enabled, false);
    assert.ok(Number.isInteger(s.port) && s.port >= 1024 && s.port <= 65535);
    assert.ok(Array.isArray(s.addresses) && Array.isArray(s.devices));
    assert.ok(["allowed", "blocked", "no_rule", "unknown"].includes(s.firewall));
    assert.equal(s.link, "");
    assert.equal(s.qrSvg, "");
  }],

  ["dc.enable: link is metrolist://device-connect?a=ip:port,...&n=name, qrSvg is an <svg>, state event follows", async (ctx) => {
    const c = await ui(ctx);
    await dcOff(c);
    await c.sub("dc");
    await c.waitEvent((e) => e.ev === "dc.snapshot");
    await c.call("dc.enable", { on: true });
    const ev = await c.waitEvent((e) => e.ev === "dc.state" && e.p.enabled);
    const s = await c.call("dc.state");
    assert.deepEqual(ev.p.link, s.link);
    assert.match(s.link, LINK);
    const u = new URL(s.link);
    const a = u.searchParams.get("a").split(",");
    assert.ok(a.length >= 1);
    for (const x of a) assert.match(x, /^[^:]+(:\d+)?:\d{2,5}$|^[\w.-]+:\d{2,5}$/, `address ${x}`);
    assert.ok(a.every((x) => x.endsWith(`:${s.port}`)), "every endpoint uses the port");
    assert.ok(u.searchParams.get("n"));
    assert.match(s.qrSvg, /^<svg[\s>]/);
    assert.ok(!/<script|\son\w+=/i.test(s.qrSvg), "QR svg carries no script");
    await dcOff(c);
  }],

  ["dc.setPort: range 1024..65535; the link follows the port", async (ctx) => {
    const c = await ui(ctx);
    await c.call("dc.enable", { on: true });
    assert.equal(await code(c, "dc.setPort", { port: 80 }), "bad_request");
    assert.equal(await code(c, "dc.setPort", { port: 70000 }), "bad_request");
    assert.equal(await code(c, "dc.setPort", { port: 4242.5 }), "bad_request");
    await c.call("dc.setPort", { port: 48911 });
    const s = await c.call("dc.state");
    assert.equal(s.port, 48911);
    assert.ok(s.link.includes(":48911"), s.link);
    await c.call("dc.setPort", { port: 48765 });
    await dcOff(c);
  }],

  ["dc.connectLink: junk and foreign links are bad_request", async (ctx) => {
    const c = await ui(ctx);
    for (const link of ["", "not a link", "https://example.com/?a=1.2.3.4:80", "metrolist://device-connect", "metrolist://device-connect?a=nope"]) {
      assert.equal(await code(c, "dc.connectLink", { link }), "bad_request", JSON.stringify(link));
    }
  }],

  ["dc.accept / reject / confirmSas / forget / transferTo with an unknown id", async (ctx) => {
    const c = await ui(ctx);
    for (const [m, p] of [["dc.accept", { requestId: "nope" }], ["dc.confirmSas", { requestId: "nope", match: true }], ["dc.forget", { deviceId: "nope" }], ["dc.transferTo", { deviceId: "nope" }], ["dc.attach", { deviceId: "nope" }]]) {
      assert.equal(await code(c, m, p), "not_found", m);
    }
  }],

  ["lt.state: idle shape; servers list the current one; blocked is a list; invite needs a room", async (ctx) => {
    const c = await ui(ctx);
    await ltIdle(c);
    const s = await c.call("lt.state");
    assert.equal(s.status, "idle");
    assert.equal(s.room, undefined);
    assert.equal(typeof s.server, "string");
    const sv = await c.call("lt.servers");
    assert.ok(Array.isArray(sv.items));
    for (const it of sv.items) assert.equal(typeof it.url, "string");
    assert.ok(Array.isArray((await c.call("lt.blocked")).items));
    assert.ok(["bad_request", "not_found", "unavailable"].includes(await code(c, "lt.invite")), "invite outside a room fails");
  }],

  ["lt.join: a code that is not 6 letters/digits is bad_request", async (ctx) => {
    const c = await ui(ctx);
    await ltIdle(c);
    assert.equal(await code(c, "lt.join", { code: "ab", name: "Minh" }), "bad_request");
    assert.equal(await code(c, "lt.setServer", { url: "not a url" }), "bad_request");
  }],
];

export const mockOnly = [
  ["dc pairing: incoming request carries a SAS; accept needs the SAS confirmed; the device then shows up paired", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("dc");
    const { requestId } = await hook(c, "mock.dc.incoming", { peer: "Redmi Note" });
    const ev = await c.waitEvent((e) => e.ev === "dc.request" && e.p.requestId === requestId);
    assert.equal(ev.p.peer, "Redmi Note");
    assert.match(ev.p.sas, /^\d{6}$/);
    assert.equal(await code(c, "dc.accept", { requestId }), "bad_request", "accept before SAS confirmation");
    await c.call("dc.confirmSas", { requestId, match: true });
    await c.call("dc.accept", { requestId });
    const st = await c.call("dc.state");
    const d = st.devices.find((x) => x.name === "Redmi Note");
    assert.ok(d && d.paired && d.online);
    await c.call("dc.forget", { deviceId: d.id });
    assert.ok(!(await c.call("dc.state")).devices.some((x) => x.id === d.id));
  }],

  ["dc pairing by link: connectLink raises a request, never auto-connects; SAS mismatch drops it", async (ctx) => {
    const c = await ui(ctx);
    await c.sub("dc");
    const before = (await c.call("dc.state")).devices.length;
    await c.call("dc.connectLink", { link: "metrolist://device-connect?a=192.168.1.50:48765&n=Phone%20B" });
    const ev = await c.waitEvent((e) => e.ev === "dc.request");
    assert.equal(ev.p.peer, "Phone B");
    assert.equal((await c.call("dc.state")).devices.length, before, "no device added before approval");
    await c.call("dc.confirmSas", { requestId: ev.p.requestId, match: false });
    await c.call("dc.reject", { requestId: ev.p.requestId }); // idempotent
    assert.equal((await c.call("dc.state")).devices.length, before);
  }],

  ["dc session: transferTo/attach need an online device, release clears the session", async (ctx) => {
    const c = await ui(ctx);
    const st = await c.call("dc.state");
    const online = st.devices.find((d) => d.online);
    const offline = st.devices.find((d) => !d.online);
    assert.ok(online && offline);
    assert.equal(await code(c, "dc.transferTo", { deviceId: offline.id }), "bad_request");
    await c.call("dc.attach", { deviceId: online.id });
    assert.deepEqual((await c.call("dc.state")).session, { peerId: online.id, role: "controller" });
    await c.call("dc.release", { deviceId: online.id });
    assert.equal((await c.call("dc.state")).session, undefined);
  }],

  ["lt host: create, join request -> approve/reject, suggestion -> approve, kick blocks, transfer host, leave", async (ctx) => {
    const c = await ui(ctx);
    await ltIdle(c);
    await c.sub("lt");
    await c.call("lt.create", { name: "Minh" });
    const s = await c.call("lt.state");
    assert.equal(s.status, "host");
    assert.match(s.room.code, /^[A-Z0-9]{6}$/);
    assert.deepEqual(s.room.users.map((u) => [u.name, u.host]), [["Minh", true]]);
    assert.ok((await c.call("lt.invite")).url.includes(s.room.code));

    const a = await hook(c, "mock.lt.joinRequest", { name: "Hùng" });
    const jr = await c.waitEvent((e) => e.ev === "lt.joinRequest");
    assert.deepEqual(jr.p, { userId: a.userId, name: "Hùng" });
    assert.equal((await c.call("lt.state")).room.pending.length, 1);
    await c.call("lt.approve", { userId: a.userId });
    assert.equal((await c.call("lt.state")).room.users.length, 2);
    const b = await hook(c, "mock.lt.joinRequest", { name: "Mai" });
    await c.call("lt.reject", { userId: b.userId });
    assert.equal((await c.call("lt.state")).room.pending.length, 0);

    const sg = await hook(c, "mock.lt.suggestion", { by: "Hùng" });
    const ev = await c.waitEvent((e) => e.ev === "lt.suggestion");
    assert.equal(ev.p.id, sg.id);
    await c.call("lt.suggestion.approve", { id: sg.id });
    assert.equal(await code(c, "lt.suggestion.reject", { id: sg.id }), "not_found");

    await c.call("lt.kick", { userId: a.userId });
    assert.equal((await c.call("lt.state")).room.users.length, 1);
    const blocked = (await c.call("lt.blocked")).items;
    assert.ok(blocked.some((x) => x.id === a.userId));
    await c.call("lt.unblock", { id: a.userId });
    assert.equal((await c.call("lt.blocked")).items.some((x) => x.id === a.userId), false);

    const d = await hook(c, "mock.lt.joinRequest", { name: "Nam" });
    await c.call("lt.approve", { userId: d.userId });
    await c.call("lt.transferHost", { userId: d.userId });
    assert.equal((await c.call("lt.state")).status, "guest");
    await c.call("lt.leave");
    assert.equal((await c.call("lt.state")).status, "idle");
  }],

  ["lt guest: join, suggest the current track, leave; unknown room is not_found and sets state.error", async (ctx) => {
    const c = await ui(ctx);
    await ltIdle(c);
    assert.equal(await code(c, "lt.join", { code: "NOROOM", name: "Minh" }), "not_found");
    const s0 = await c.call("lt.state");
    assert.equal(s0.status, "idle");
    assert.ok(s0.error);
    await c.call("lt.join", { code: "abc123", name: "Minh" });
    const s = await c.call("lt.state");
    assert.equal(s.status, "guest");
    assert.equal(s.room.code, "ABC123");
    assert.ok(s.room.users.some((u) => u.host));
    const some = (await c.call("library.window", { list: "songs", sort: { by: "added", desc: true }, offset: 0, limit: 1 })).items[0];
    await c.call("lt.suggest", { trackId: some.id });
    assert.equal(await code(c, "lt.kick", { userId: "u-host" }), "bad_request", "guests cannot kick");
    await c.call("lt.leave");
    assert.equal((await c.call("lt.state")).status, "idle");
  }],

  ["lt.setServer: stored and reflected in lt.servers/lt.state", async (ctx) => {
    const c = await ui(ctx);
    await ltIdle(c);
    const { items } = await c.call("lt.servers");
    const other = items.find((x) => x.url !== (items[0] && items[0].url)) ?? items[0];
    await c.call("lt.setServer", { url: other.url });
    assert.equal((await c.call("lt.servers")).current, other.url);
    assert.equal((await c.call("lt.state")).server, other.url);
    await c.call("lt.setServer", { url: items[0].url });
  }],
];
