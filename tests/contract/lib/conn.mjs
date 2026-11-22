// Raw protocol connection for contract tests (does not use the UI client, so wire behaviour is tested as is).
import { WebSocket } from "ws";
import { checkEvent, checkMethod } from "./schema.mjs";

export class Conn {
  constructor(ws, ctx) {
    this.ws = ws;
    this.ctx = ctx;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.waiters = [];
    this.closed = null; // {code, reason}
    this.closeWaiters = [];
    this.schemaErrors = [];
    ws.on("message", (d) => this.onMessage(d.toString("utf8")));
    ws.on("close", (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      for (const [, p] of this.pending) p.reject(new Error(`closed ${code}`));
      this.pending.clear();
      for (const w of this.closeWaiters.splice(0)) w(this.closed);
    });
    ws.on("error", () => {});
  }

  /** Open a socket. Resolves with a Conn, or rejects with {status} when the upgrade is refused. */
  static open(ctx, { origin, path = "/rpc", port = ctx.port } = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, origin === undefined ? undefined : { origin });
      ws.once("open", () => resolve(new Conn(ws, ctx)));
      ws.once("unexpected-response", (_req, res) => reject(Object.assign(new Error(`upgrade refused ${res.statusCode}`), { status: res.statusCode })));
      ws.once("error", (e) => reject(e));
    });
  }

  /** open + sys.hello with the target token */
  static async connect(ctx, opts = {}) {
    const c = await Conn.open(ctx, opts);
    const r = await c.call("sys.hello", { token: opts.token ?? ctx.token, role: opts.role ?? "ui", protocol: 1, client: "contract/0.1", locale: "vi" });
    c.hello = r;
    return c;
  }

  onMessage(text) {
    const msg = JSON.parse(text);
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (p) { this.pending.delete(msg.id); p.resolve(msg); }
    } else if (msg.ev) {
      const bad = checkEvent(msg.ev, msg.p);
      if (bad) this.schemaErrors.push(`event ${msg.ev}: ${bad}`);
      this.events.push(msg);
      for (const w of [...this.waiters]) w();
    }
  }

  send(obj) { this.ws.send(JSON.stringify(obj)); }

  /** Returns the raw response {id, r?, e?}. Validates params (when `validate`) and result against the schema. */
  async raw(m, p, { validate = true } = {}) {
    const id = this.nextId++;
    if (validate && p !== undefined) {
      const bad = checkMethod(m, "p", p);
      if (bad) throw new Error(`test bug: params of ${m} do not match the schema: ${bad}`);
    }
    const res = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${m}: no response in 15 s`)), 15000);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    });
    this.send(p === undefined ? { id, m } : { id, m, p });
    const msg = await res;
    if (validate && msg.r !== undefined) {
      const bad = checkMethod(m, "r", msg.r);
      if (bad) throw new Error(`${m}: result violates schema: ${bad}`);
    }
    return msg;
  }

  /** Result or throw with the error code. */
  async call(m, p) {
    const msg = await this.raw(m, p);
    if (msg.e) throw Object.assign(new Error(`${m}: ${msg.e.code}: ${msg.e.msg}`), { code: msg.e.code, api: msg.e });
    if (msg.r === undefined) throw new Error(`${m}: response has neither r nor e`);
    return msg.r;
  }

  async sub(topic, params) {
    const { sub } = await this.call("sub.open", params ? { topic, params } : { topic });
    return sub;
  }

  /** Wait for an event matching pred among events not consumed yet (consumes it). */
  waitEvent(pred, ms = 5000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const check = () => {
        const i = this.events.findIndex(pred);
        if (i >= 0) { clear(); resolve(this.events.splice(i, 1)[0]); return true; }
        return false;
      };
      const clear = () => { clearTimeout(timer); const j = this.waiters.indexOf(check); if (j >= 0) this.waiters.splice(j, 1); };
      const timer = setTimeout(() => { clear(); reject(new Error(`timeout waiting for event (${ms} ms, ${this.events.length} others queued: ${this.events.map((e) => e.ev).slice(0, 8).join(",")})`)); }, ms - (Date.now() - t0));
      if (!check()) this.waiters.push(check);
    });
  }

  waitClose(ms = 5000) {
    if (this.closed) return Promise.resolve(this.closed);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`socket not closed within ${ms} ms`)), ms);
      this.closeWaiters.push((c) => { clearTimeout(t); resolve(c); });
    });
  }

  close() { try { this.ws.terminate(); } catch { /* ignore */ } }
}
