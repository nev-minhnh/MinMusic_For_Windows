#!/usr/bin/env node
// Mock sidecar: the same stdin/READY contract as the real core (architecture 3.3).
//   stdin line 1 : {"token":"<64 hex>","artToken":"<32 hex>","protocol":1}
//   stdin later  : {"cmd":"shutdown"}  -> exit 0 after 200 ms
//   stdin EOF    -> exit 0 after 200 ms
//   stdout line 1: READY {"port":<u16>,"pid":<u32>,"version":"...","protocol":1}
//   writes $LOCALAPPDATA\MinMusic\state\metrolist\core.pid = {pid,startTimeMs,exe}
// Flags: --parent-pid <n> (poll every 2 s, exit when gone), --dev (allow Origin http://localhost:5173).
// Other core flags (--data-root, --log-dir, --fixture-home, ...) are accepted and ignored.
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { startMock } from "../src/server.ts";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const parentPid = Number(flag("--parent-pid")) || 0;
const dev = argv.includes("--dev");

const base = process.env.LOCALAPPDATA || join(os.tmpdir(), "MinMusic-mock");
const stateDir = join(base, "MinMusic", "state", "metrolist");
const pidFile = join(stateDir, "core.pid");

let handle = null;
let exiting = false;
function shutdown(reason, code = 0) {
  if (exiting) return;
  exiting = true;
  setTimeout(async () => {
    try { await handle?.close(); } catch { /* ignore */ }
    try { rmSync(pidFile, { force: true }); } catch { /* ignore */ }
    process.exit(code);
  }, 200).unref?.();
  // keep the loop alive until the timer fires even though it is unref'd above
  setTimeout(() => {}, 1000);
  void reason;
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let first = true;
rl.on("line", async (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (first) {
    first = false;
    if (typeof msg.token !== "string") { console.error("bad first line"); process.exit(2); }
    handle = await startMock({
      port: 0, token: msg.token, artToken: msg.artToken ?? "mockart",
      allowedOrigins: dev ? ["http://localhost:5173"] : [],
      capabilities: [],
    });
    try {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(pidFile, JSON.stringify({ pid: process.pid, startTimeMs: Math.round(Date.now() - process.uptime() * 1000), exe: process.execPath }));
    } catch (e) { console.error("pidfile:", e.message); }
    process.stdout.write(`READY ${JSON.stringify({ port: handle.port, pid: process.pid, version: "0.1.0-mock", protocol: 1 })}\n`);
    return;
  }
  if (msg.cmd === "shutdown") shutdown("cmd");
});
rl.on("close", () => shutdown("stdin-eof"));
process.stdin.on("error", () => shutdown("stdin-error"));
process.on("SIGTERM", () => shutdown("sigterm"));
process.on("SIGINT", () => shutdown("sigint"));
if (parentPid > 0) {
  setInterval(() => {
    try { process.kill(parentPid, 0); } catch (e) { if (e.code === "ESRCH") shutdown("parent-gone"); }
  }, 2000).unref();
}
