// node mock-core/scripts/bench-window.mjs : frame size and JSON.parse time of a 200-row library.window
import { startMock } from "../src/server.ts";
import { WebSocket } from "ws";

const m = await startMock({ token: "b" });
const ws = new WebSocket(`ws://127.0.0.1:${m.port}/rpc`);
await new Promise((r) => ws.once("open", r));
const next = () => new Promise((r) => ws.once("message", (d) => r(d.toString("utf8"))));
ws.send(JSON.stringify({ id: 1, m: "sys.hello", p: { token: "b", role: "ui", protocol: 1, client: "bench", locale: "vi" } }));
await next();
ws.send(JSON.stringify({ id: 2, m: "library.window", p: { list: "songs", sort: { by: "added", desc: true }, offset: 0, limit: 200 } }));
const frame = await next();
const bytes = Buffer.byteLength(frame);
const N = 500;
for (let i = 0; i < 50; i++) JSON.parse(frame); // warm-up
const t0 = performance.now();
for (let i = 0; i < N; i++) JSON.parse(frame);
const avg = (performance.now() - t0) / N;
const one = performance.now();
JSON.parse(frame);
const cold = performance.now() - one;
console.log(`200-row window: ${(bytes / 1024).toFixed(1)} KiB, JSON.parse avg ${avg.toFixed(3)} ms (n=${N}), single ${cold.toFixed(3)} ms`);
ws.close();
await m.close();
