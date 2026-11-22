// WebSocket RPC client for the core (api.md §1). Framework-agnostic; stores wrap it with Solid signals.
import {
  CLOSE_UNAUTHORIZED, PROTOCOL_VERSION, RpcError, timeoutFor,
  type ApiError, type CoreConfig, type HelloResult, type MethodName, type Methods, type Role, type Topic,
} from "@minmusic/protocol";

export type Status = "connecting" | "ready" | "reconnecting" | "failed";

/** Back-off between reconnect attempts, ms. The last value repeats (api.md §1.6). */
export const BACKOFF_MS: readonly number[] = [100, 250, 500, 1000, 2000];

export type ConfigProvider = () => Promise<CoreConfig> | CoreConfig;

export interface ClientOptions {
  /** Called before EVERY connection attempt: a restarted core has a new port and token. */
  config: CoreConfig | ConfigProvider;
  role?: Role;
  /** "ui/0.1.0" */
  client?: string;
  locale?: string;
  WebSocketImpl?: typeof WebSocket;
  backoffMs?: readonly number[];
  /** Override for tests (ms); `null` disables timeouts. */
  timeoutMs?: number | null;
  /** Time budget for the hello response before the attempt is abandoned. */
  helloTimeoutMs?: number;
}

type Pending = {
  resolve: (v: any) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
  m: string;
  /** runs synchronously when the response frame arrives, before any later frame is processed */
  sync?: (r: any) => void;
};

type SubEntry = {
  topic: Topic;
  params?: object;
  handler: (ev: string, p: any, seq: number | undefined) => void;
  subId: number | null;
  lastSeq: number | null;
  closed: boolean;
};

export type SubHandler = (ev: string, p: any) => void;

function networkError(msg: string): RpcError {
  return new RpcError({ code: "network", msg, retryable: true });
}

export class CoreClient {
  private opts: ClientOptions;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private subs = new Set<SubEntry>();
  private subsById = new Map<number, SubEntry>();
  private _status: Status = "connecting";
  private statusListeners = new Set<(s: Status) => void>();
  private readyWaiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  private stopped = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _hello: HelloResult | null = null;
  private _config: CoreConfig | null = null;
  /** Number of completed hello handshakes (>=2 means we reconnected at least once). */
  connections = 0;
  lastCloseCode: number | null = null;

  constructor(opts: ClientOptions) {
    this.opts = opts;
  }

  get status(): Status { return this._status; }
  get hello(): HelloResult | null { return this._hello; }
  /** The config used for the current/last connection (port, token, artToken). */
  get config(): CoreConfig | null { return this._config; }
  hasCapability(name: string): boolean { return this._hello?.capabilities.includes(name) ?? false; }

  onStatus(cb: (s: Status) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private setStatus(s: Status) {
    if (this._status === s) return;
    this._status = s;
    for (const cb of [...this.statusListeners]) cb(s);
  }

  /** Begin connecting. Resolves when the first handshake completes. Keeps reconnecting after that. */
  start(): Promise<void> {
    this.stopped = false;
    const ready = this.whenReady();
    void this.open();
    return ready;
  }

  private whenReady(): Promise<void> {
    if (this._status === "ready") return Promise.resolve();
    return new Promise<void>((resolve, reject) => this.readyWaiters.push({ resolve, reject }));
  }

  private async open() {
    if (this.stopped) return;
    let cfg: CoreConfig;
    try {
      cfg = typeof this.opts.config === "function" ? await this.opts.config() : this.opts.config;
    } catch {
      this.scheduleRetry();
      return;
    }
    if (this.stopped) return;
    this._config = cfg;
    const WS = this.opts.WebSocketImpl ?? WebSocket;
    let ws: WebSocket;
    try {
      ws = new WS(`ws://127.0.0.1:${cfg.port}/rpc`);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    this.nextId = 1;
    let handshakeDone = false;
    const helloTimer = setTimeout(() => {
      if (!handshakeDone) try { ws.close(); } catch { /* ignore */ }
    }, this.opts.helloTimeoutMs ?? 5000);

    ws.onopen = () => {
      const id = this.nextId++;
      const p = {
        token: cfg.token, role: this.opts.role ?? "ui", protocol: PROTOCOL_VERSION,
        client: this.opts.client ?? "ui/0.1.0", locale: this.opts.locale ?? "vi",
      };
      new Promise<HelloResult>((resolve, reject) => {
        this.pending.set(id, { resolve, reject, timer: null, m: "sys.hello" });
      }).then((h) => {
        if (this.ws !== ws) return;
        handshakeDone = true;
        clearTimeout(helloTimer);
        this._hello = h;
        this.attempt = 0;
        this.connections++;
        this.setStatus("ready");
        this.resubscribeAll();
        const w = this.readyWaiters.splice(0);
        for (const x of w) x.resolve();
      }, () => { /* the close handler deals with it */ });
      ws.send(JSON.stringify({ id, m: "sys.hello", p }));
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.onFrame(typeof e.data === "string" ? e.data : String(e.data));
    };
    ws.onerror = () => { /* followed by close */ };
    ws.onclose = (e) => {
      clearTimeout(helloTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      this.lastCloseCode = e.code;
      this.failPending(networkError(`connection closed (${e.code})`));
      for (const s of this.subs) { s.subId = null; s.lastSeq = null; }
      this.subsById.clear();
      if (this.stopped) return;
      if (e.code === CLOSE_UNAUTHORIZED) {
        // bad token: no reconnect (api.md section 1.6); the owner must restart the connection with a new config
        this.setStatus("failed");
        for (const x of this.readyWaiters.splice(0)) x.reject(new RpcError({ code: "unauthorized", msg: "bad token", retryable: false }));
        return;
      }
      this.setStatus(this.connections > 0 ? "reconnecting" : "connecting");
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (this.stopped) return;
    const sched = this.opts.backoffMs ?? BACKOFF_MS;
    const delay = sched[Math.min(this.attempt, sched.length - 1)] ?? 2000;
    this.attempt++;
    if (this._status === "ready") this.setStatus("reconnecting");
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.open(); }, delay);
  }

  private failPending(err: unknown) {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
  }

  private onFrame(text: string) {
    let msg: any;
    try { msg = JSON.parse(text); } catch { return; }
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (p.timer) clearTimeout(p.timer);
      if (msg.e) p.reject(new RpcError(msg.e as ApiError));
      else { p.sync?.(msg.r); p.resolve(msg.r); }
      return;
    }
    if (typeof msg.ev === "string") {
      const entry = typeof msg.sub === "number" ? this.subsById.get(msg.sub) : undefined;
      if (!entry || entry.closed) return;
      const seq: number | undefined = msg.seq;
      if (typeof seq === "number") {
        if (entry.lastSeq !== null && seq !== entry.lastSeq + 1) {
          // gap: re-subscribe, the new snapshot replaces whatever we missed (api.md §1.6)
          void this.reopen(entry);
          return;
        }
        entry.lastSeq = seq;
      }
      entry.handler(msg.ev, msg.p, seq);
    }
  }

  // ---- calls

  /** Typed request. Waits for the connection to be ready (queues across reconnects). */
  async call<K extends MethodName>(
    m: K, ...args: {} extends Methods[K]["p"] ? [p?: Methods[K]["p"], timeoutMs?: number | null] : [p: Methods[K]["p"], timeoutMs?: number | null]
  ): Promise<Methods[K]["r"]> {
    const [p, tmo] = args as [object | undefined, (number | null | undefined)];
    const timeout = tmo !== undefined ? tmo : this.opts.timeoutMs !== undefined ? this.opts.timeoutMs : timeoutFor(m);
    if (this._status !== "ready") {
      await this.waitReadyWithTimeout(m, timeout);
    }
    return this.send(m, p, timeout);
  }

  private waitReadyWithTimeout(m: string, timeout: number | null): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const waiter = {
        resolve: () => { if (timer) clearTimeout(timer); resolve(); },
        reject: (e: unknown) => { if (timer) clearTimeout(timer); reject(e); },
      };
      this.readyWaiters.push(waiter);
      if (timeout !== null) {
        timer = setTimeout(() => {
          const i = this.readyWaiters.indexOf(waiter);
          if (i >= 0) this.readyWaiters.splice(i, 1);
          reject(new RpcError({ code: "timeout", msg: `${m}: not connected`, retryable: true }));
        }, timeout);
      }
    });
  }

  private send<T>(m: string, p: object | undefined, timeout: number | null, sync?: (r: any) => void): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return Promise.reject(networkError("not connected"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const entry: Pending = { resolve, reject, timer: null, m, sync };
      if (timeout !== null) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new RpcError({ code: "timeout", msg: `${m}: timeout after ${timeout} ms`, retryable: true }));
        }, timeout);
      }
      this.pending.set(id, entry);
      ws.send(JSON.stringify(p === undefined ? { id, m } : { id, m, p }));
    });
  }

  // ---- subscriptions

  /**
   * Subscribe to a topic. The handler gets every event of the subscription, the `<topic>.snapshot` first.
   * Survives reconnects (re-sent after each hello) and seq gaps. Returns an unsubscribe function.
   */
  sub<T extends Topic>(topic: T, handler: SubHandler, params?: object): () => void {
    const entry: SubEntry = { topic, params, handler: (ev, p) => handler(ev, p), subId: null, lastSeq: null, closed: false };
    this.subs.add(entry);
    if (this._status === "ready") void this.openSub(entry);
    return () => {
      if (entry.closed) return;
      entry.closed = true;
      this.subs.delete(entry);
      if (entry.subId !== null) {
        this.subsById.delete(entry.subId);
        if (this._status === "ready") void this.send("sub.close", { sub: entry.subId }, 5000).catch(() => {});
      }
    };
  }

  private async openSub(entry: SubEntry) {
    try {
      // Register synchronously on the response frame: the snapshot may follow in the same tick.
      await this.send<{ sub: number }>("sub.open", entry.params ? { topic: entry.topic, params: entry.params } : { topic: entry.topic }, 10_000, (r) => {
        if (entry.closed) {
          void this.send("sub.close", { sub: r.sub }, 5000).catch(() => {});
          return;
        }
        entry.subId = r.sub;
        entry.lastSeq = null;
        this.subsById.set(r.sub, entry);
      });
    } catch {
      // connection died mid-flight: resubscribeAll runs after the next hello
    }
  }

  private resubscribeAll() {
    for (const s of this.subs) void this.openSub(s);
  }

  private async reopen(entry: SubEntry) {
    if (entry.subId !== null) {
      this.subsById.delete(entry.subId);
      void this.send("sub.close", { sub: entry.subId }, 5000).catch(() => {});
      entry.subId = null;
    }
    entry.lastSeq = null;
    await this.openSub(entry);
  }

  /** Close for good (no reconnect). */
  close() {
    this.stopped = true;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    const ws = this.ws;
    this.ws = null;
    this.failPending(networkError("client closed"));
    for (const w of this.readyWaiters.splice(0)) w.reject(networkError("client closed"));
    try { ws?.close(); } catch { /* ignore */ }
  }
}

/** Convenience wrapper matching the brief: `connect(config)` returns a started client. */
export function connect(config: CoreConfig | ConfigProvider, opts: Omit<ClientOptions, "config"> = {}): CoreClient {
  const c = new CoreClient({ ...opts, config });
  void c.start().catch(() => { /* status carries the failure */ });
  return c;
}
