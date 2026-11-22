// Mock core: speaks the api.md envelope over ws://127.0.0.1:<port>/rpc with hello/token/Origin checks,
// subscriptions and one handler module per area (handlers/*.ts, loaded at start). Everything unknown answers `bad_request`.
// Runs directly on Node >= 22.6 (type stripping); no build step.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { Dataset } from "./gen.ts";
import { createState, type Handler, type HandlerModule, type MockOptions, type Session, type TopicSnapshot } from "./state.ts";
import { ApiErr, bad, hash32, isObj } from "./util.ts";

export type { MockOptions } from "./state.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface MockHandle {
  port: number;
  token: string;
  artToken: string;
  dataset: Dataset;
  /** Abruptly close every socket (simulates a core crash for the client). Server keeps listening. */
  dropConnections(code?: number): void;
  close(): Promise<void>;
  sessionCount(): number;
}

/** Load every handlers/*.ts. A method or topic defined twice is a programming error: throw. */
export async function loadHandlers(dir = join(HERE, "handlers")) {
  const handlers = new Map<string, { fn: Handler; file: string }>();
  const topics = new Map<string, { fn: TopicSnapshot; file: string }>();
  const files = readdirSync(dir).filter((f) => /\.(ts|mjs|js)$/.test(f) && !f.endsWith(".d.ts") && !f.endsWith(".test.ts")).sort();
  for (const f of files) {
    const mod = (await import(pathToFileURL(join(dir, f)).href)) as HandlerModule;
    for (const [m, fn] of Object.entries(mod.handlers ?? {})) {
      const dup = handlers.get(m);
      if (dup) throw new Error(`mock-core: duplicate method ${m} in ${dup.file} and ${f}`);
      handlers.set(m, { fn, file: f });
    }
    for (const [t, fn] of Object.entries(mod.topics ?? {})) {
      const dup = topics.get(t);
      if (dup) throw new Error(`mock-core: duplicate topic ${t} in ${dup.file} and ${f}`);
      topics.set(t, { fn, file: f });
    }
  }
  return { handlers, topics, files };
}

export async function startMock(opts: MockOptions): Promise<MockHandle> {
  const st = createState(opts);
  let loaded;
  try { loaded = await loadHandlers(); } catch (e) { st.close(); throw e; }
  const { handlers: H, topics: T } = loaded;
  const { sessions, rawSend, emit } = st;

  function handleSub(s: Session, m: string, p: any): unknown {
    if (m === "sub.open") {
      const topic = p?.topic;
      const t = typeof topic === "string" ? T.get(topic) : undefined;
      if (!t) throw bad(`unsupported topic ${String(topic)}`);
      const id = s.nextSub++;
      const sub = { topic: topic as string, seq: 0, params: isObj(p?.params) ? p.params : undefined };
      s.subs.set(id, sub);
      // The first event of a subscription is the snapshot, after the response.
      setImmediate(() => {
        if (!s.subs.has(id)) return;
        sub.seq++;
        rawSend(s, JSON.stringify({ ev: `${topic}.snapshot`, p: t.fn({ st }), sub: id, seq: sub.seq }));
      });
      return { sub: id };
    }
    const id = p?.sub;
    if (typeof id !== "number") throw bad("sub required");
    s.subs.delete(id);
    return {};
  }

  // ---- transport
  const allowed = new Set(["", "http://tauri.localhost", ...(opts.allowedOrigins ?? [])]);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    const m = /^\/art\/([^/]+)\/(.+)$/.exec(u.pathname);
    if (req.method === "GET" && m) {
      if (u.searchParams.get("k") !== st.artToken) { res.writeHead(401).end(); return; }
      const w = Math.max(16, Math.min(1080, Number(u.searchParams.get("w")) || 256));
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=31536000, immutable" });
      res.end(artSvg(decodeURIComponent(m[2]!), w));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024, perMessageDeflate: false });
  server.on("upgrade", (req, socket, head) => {
    const path = (req.url ?? "").split("?")[0];
    const origin = req.headers.origin ?? "";
    if (path !== "/rpc" || !allowed.has(origin)) {
      socket.write(`HTTP/1.1 ${path !== "/rpc" ? "404 Not Found" : "403 Forbidden"}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });

  function onConnection(ws: WebSocket) {
    const s: Session = { ws, authed: false, role: "", subs: new Map(), nextSub: 1, helloTimer: null };
    sessions.add(s);
    s.helloTimer = setTimeout(() => { if (!s.authed) ws.close(4401, "hello timeout"); }, opts.helloTimeoutMs ?? 2000);
    ws.on("close", () => { sessions.delete(s); s.cancelSuggest?.(); if (s.helloTimer) clearTimeout(s.helloTimer); });
    ws.on("error", () => {});
    ws.on("message", async (data, isBinary) => {
      if (isBinary) { ws.close(1003, "text frames only"); return; }
      let msg: any;
      try { msg = JSON.parse(data.toString("utf8")); } catch { ws.close(1007, "bad json"); return; }
      if (!s.authed) {
        if (msg?.m !== "sys.hello" || !isObj(msg.p) || msg.p.token !== opts.token) { ws.close(4401, "unauthorized"); return; }
        if (typeof msg.p.protocol !== "number" || msg.p.protocol < 0 || msg.p.protocol > 1) {
          rawSend(s, JSON.stringify({ id: msg.id, e: { code: "unsupported", msg: "protocol mismatch", retryable: false } }));
          ws.close(1002, "protocol");
          return;
        }
        s.authed = true; s.role = String(msg.p.role ?? "ui");
        if (s.helloTimer) { clearTimeout(s.helloTimer); s.helloTimer = null; }
        rawSend(s, JSON.stringify({
          id: msg.id,
          r: { protocol: 1, core: "0.1.0-mock", sessionId: `mock-${Date.now().toString(36)}`, capabilities: st.caps, serverTime: Date.now() },
        }));
        return;
      }
      if (typeof msg?.id !== "number" || typeof msg.m !== "string") { ws.close(1007, "bad envelope"); return; }
      try {
        let r: unknown;
        if (msg.m === "sys.hello") throw bad("already authenticated");
        else if (msg.m === "sub.open" || msg.m === "sub.close") r = handleSub(s, msg.m, msg.p);
        else {
          const h = H.get(msg.m);
          if (!h) throw bad(`unknown method ${msg.m}`);
          r = await h.fn(msg.p, { s, st, emit });
        }
        rawSend(s, JSON.stringify({ id: msg.id, r }));
      } catch (e) {
        const err = e instanceof ApiErr ? e.err : { code: "internal", msg: String((e as Error)?.message ?? e), retryable: false };
        rawSend(s, JSON.stringify({ id: msg.id, e: err }));
      }
    });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;

  return {
    port, token: opts.token, artToken: st.artToken, dataset: st.dataset,
    sessionCount: () => sessions.size,
    dropConnections(code = 1011) {
      for (const s of sessions) { try { s.ws.terminate(); } catch { /* ignore */ } }
      void code;
    },
    async close() {
      st.close();
      for (const s of sessions) { try { s.ws.terminate(); } catch { /* ignore */ } }
      wss.close();
      await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections?.(); });
    },
  };
}

function artSvg(id: string, size: number): string {
  const h = hash32(id);
  const h1 = h % 360, h2 = (h1 + 40 + ((h >>> 9) % 80)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1} 65% 45%)"/><stop offset="1" stop-color="hsl(${h2} 70% 30%)"/></linearGradient></defs>` +
    `<rect width="100" height="100" fill="url(#g)"/><text x="50" y="64" font-family="sans-serif" font-size="44" text-anchor="middle" fill="rgba(255,255,255,.75)">♪</text></svg>`;
}
