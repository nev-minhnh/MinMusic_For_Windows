#!/usr/bin/env node
// Mock core for Vite dev: fixed port 47999, token "dev", allows Origin http://localhost:5173.
//   node mock-core/bin/dev.mjs     then put the printed line into ui/.env.local
import { startMock } from "../src/server.ts";

const port = Number(process.env.MOCK_PORT) || 47999;
const h = await startMock({
  port, token: "dev", artToken: "devart",
  allowedOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"],
  remoteArt: process.env.MOCK_REMOTE_ART === "1",
  capabilities: ["video"],
});
console.log(`mock core listening on ws://127.0.0.1:${h.port}/rpc`);
console.log(`VITE_MM_CORE=${JSON.stringify({ port: h.port, token: "dev", artToken: "devart" })}`);
const stop = async () => { await h.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
