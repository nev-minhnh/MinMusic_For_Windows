import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { startMock, type MockHandle } from "../../../mock-core/src/server.ts";
import { CoreClient, type Status } from "./client.ts";
import { RpcError } from "@minmusic/protocol";

const open: Array<{ close(): unknown }> = [];
afterEach(async () => { for (const o of open.splice(0)) await o.close(); });

async function waitFor(cond: () => boolean, ms = 4000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
const mock = async (token = "tok", extra = {}): Promise<MockHandle> => {
  const m = await startMock({ token, ...extra });
  open.push(m);
  return m;
};
const client = (cfg: () => { port: number; token: string; artToken: string }, extra = {}) => {
  const c = new CoreClient({ config: cfg, backoffMs: [20, 40, 80], ...extra });
  open.push(c);
  return c;
};
async function rawServer() {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  return wss;
}
const HELLO_OK = { protocol: 1, core: "x", sessionId: "s", capabilities: [], serverTime: 0 };

describe("CoreClient", () => {
  it("handshakes and makes typed calls", async () => {
    const m = await mock();
    const c = client(() => ({ port: m.port, token: "tok", artToken: "k" }));
    await c.start();
    expect(c.status).toBe("ready");
    expect(c.hello?.protocol).toBe(1);
    const counts = await c.call("library.counts");
    expect(counts.songs).toBe(5000);
    const w = await c.call("library.window", { list: "songs", sort: { by: "added", desc: true }, offset: 4900, limit: 200 });
    expect(w.items.length).toBe(100);
    expect(w.total).toBe(5000);
  });

  it("maps error responses to RpcError", async () => {
    const m = await mock();
    const c = client(() => ({ port: m.port, token: "tok", artToken: "k" }));
    await c.start();
    await expect((c.call as any)("nope.nothing", {})).rejects.toMatchObject({ code: "bad_request" });
    await expect(c.call("album.get", { id: "zzz" })).rejects.toBeInstanceOf(RpcError);
  });

  it("a bad token ends in status failed with unauthorized, no reconnect loop", async () => {
    const m = await mock();
    const c = client(() => ({ port: m.port, token: "WRONG", artToken: "k" }));
    await expect(c.start()).rejects.toMatchObject({ code: "unauthorized" });
    expect(c.status).toBe("failed");
    expect(c.lastCloseCode).toBe(4401);
    await new Promise((r) => setTimeout(r, 200));
    expect(m.sessionCount()).toBe(0);
  });

  it("times out calls that never get an answer", async () => {
    const wss = await rawServer();
    open.push({ close: () => new Promise<void>((r) => { wss.clients.forEach((x) => x.terminate()); wss.close(() => r()); }) });
    wss.on("connection", (ws) => ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.m === "sys.hello") ws.send(JSON.stringify({ id: m.id, r: HELLO_OK }));
    }));
    const port = (wss.address() as any).port;
    const c = client(() => ({ port, token: "t", artToken: "k" }), { timeoutMs: 100 });
    await c.start();
    const t0 = Date.now();
    await expect(c.call("sys.ping")).rejects.toMatchObject({ code: "timeout", retryable: true });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("subscribes: snapshot first, then state and position events", async () => {
    const m = await mock();
    const c = client(() => ({ port: m.port, token: "tok", artToken: "k" }));
    await c.start();
    const evs: Array<[string, any]> = [];
    c.sub("player", (ev, p) => evs.push([ev, p]));
    await waitFor(() => evs.length >= 1);
    expect(evs[0]![0]).toBe("player.snapshot");
    expect(evs[0]![1].track).toBeNull();
    await c.call("player.play", { context: { kind: "library", list: "songs", sort: { by: "added", desc: true } }, startIndex: 3 });
    await waitFor(() => evs.some(([e]) => e === "player.position"));
    const st = evs.find(([e]) => e === "player.state")![1];
    expect(st.playing).toBe(true);
    expect(st.track.id).toBeTruthy();
  });

  it("killing the core mid-subscription: reconnects with fresh config and receives a new snapshot", async () => {
    let m = await mock("tok1");
    let cfg = { port: m.port, token: "tok1", artToken: "k" };
    const c = client(() => cfg);
    await c.start();
    const snapshots: any[] = [];
    const statuses: Status[] = [];
    c.onStatus((s) => statuses.push(s));
    c.sub("library", (ev, p) => { if (ev === "library.snapshot") snapshots.push(p); });
    await waitFor(() => snapshots.length === 1);

    // core crashes; the shell starts a new one with another port and token
    await m.close();
    await waitFor(() => c.status === "reconnecting");
    m = await mock("tok2");
    cfg = { port: m.port, token: "tok2", artToken: "k2" };
    await waitFor(() => c.status === "ready");
    await waitFor(() => snapshots.length === 2);
    expect(statuses).toContain("reconnecting");
    expect(c.connections).toBe(2);
    expect(c.config?.token).toBe("tok2");
    expect((await c.call("library.counts")).songs).toBe(5000);
  });

  it("dropped socket (same core): resubscribes and gets a snapshot again", async () => {
    const m = await mock();
    const c = client(() => ({ port: m.port, token: "tok", artToken: "k" }));
    await c.start();
    let n = 0;
    c.sub("player", (ev) => { if (ev === "player.snapshot") n++; });
    await waitFor(() => n === 1);
    m.dropConnections();
    await waitFor(() => n === 2);
    expect(c.status).toBe("ready");
  });

  it("calls issued while reconnecting wait for the connection", async () => {
    const m = await mock();
    const c = client(() => ({ port: m.port, token: "tok", artToken: "k" }));
    await c.start();
    m.dropConnections();
    await waitFor(() => c.status !== "ready");
    const r = await c.call("library.counts");
    expect(r.songs).toBe(5000);
  });

  it("a seq gap makes the client re-subscribe", async () => {
    const wss = await rawServer();
    open.push({ close: () => new Promise<void>((r) => { wss.clients.forEach((x) => x.terminate()); wss.close(() => r()); }) });
    let opens = 0, closes = 0;
    wss.on("connection", (ws) => ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.m === "sys.hello") return ws.send(JSON.stringify({ id: m.id, r: HELLO_OK }));
      if (m.m === "sub.close") { closes++; return ws.send(JSON.stringify({ id: m.id, r: {} })); }
      if (m.m === "sub.open") {
        const sub = ++opens;
        ws.send(JSON.stringify({ id: m.id, r: { sub } }));
        ws.send(JSON.stringify({ ev: "library.snapshot", p: { n: sub }, sub, seq: 1 }));
        if (sub === 1) ws.send(JSON.stringify({ ev: "library.changed", p: { n: "gap" }, sub, seq: 3 }));
      }
    }));
    const port = (wss.address() as any).port;
    const c = client(() => ({ port, token: "t", artToken: "k" }));
    await c.start();
    const got: string[] = [];
    c.sub("library", (ev, p) => got.push(`${ev}:${p.n}`));
    await waitFor(() => got.length >= 2);
    expect(got).toEqual(["library.snapshot:1", "library.snapshot:2"]);
    expect(opens).toBe(2);
    expect(closes).toBe(1);
  });

  it("unsubscribe sends sub.close and stops delivery", async () => {
    const m = await mock();
    const c = client(() => ({ port: m.port, token: "tok", artToken: "k" }));
    await c.start();
    let n = 0;
    const off = c.sub("player", () => n++);
    await waitFor(() => n === 1);
    off();
    await c.call("player.play", { context: { kind: "tracks", ids: [m.dataset.songs[0]!.id] } });
    await new Promise((r) => setTimeout(r, 150));
    expect(n).toBe(1);
  });
});
