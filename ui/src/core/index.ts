// Public surface of the core client layer.
//
// Tauri: awaits `invoke("core_config")` (also on every reconnect: port and token change after a core restart).
// Vite dev: `VITE_MM_CORE` holds the mock core config, as JSON {"port":..,"token":..,"artToken":..}
// (or "port:token:artToken"). `mock-core/bin/dev.mjs` prints the line.
import { createSignal, type Accessor } from "solid-js";
import type { CoreConfig } from "@minmusic/protocol";
import { CoreClient, type ClientOptions, type ConfigProvider, type Status } from "./client.ts";
import { createLibraryStore } from "./stores/library.ts";
import { createPlayerStore } from "./stores/player.ts";

export * from "./client.ts";
export * from "./art.ts";
export * from "./clock.ts";
export * from "./errors.ts";
export * from "./stores/player.ts";
export * from "./stores/library.ts";
export type * from "@minmusic/protocol";

type G = typeof globalThis & {
  __MM_CORE__?: CoreConfig;
  __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: object) => Promise<unknown> };
};

export function parseCoreEnv(v: string): CoreConfig {
  const s = v.trim();
  if (s.startsWith("{")) {
    const o = JSON.parse(s);
    return { port: Number(o.port), token: String(o.token), artToken: String(o.artToken ?? o.token) };
  }
  const [port, token, artToken] = s.split(":");
  return { port: Number(port), token: token ?? "", artToken: artToken ?? token ?? "" };
}

/** Resolves the current core config: Tauri command, or the Vite dev env. Also refreshes window.__MM_CORE__. */
export const coreConfig: ConfigProvider = async () => {
  const g = globalThis as G;
  let cfg: CoreConfig;
  if (g.__TAURI_INTERNALS__) {
    cfg = (await g.__TAURI_INTERNALS__.invoke("core_config")) as CoreConfig;
  } else {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const v = env?.VITE_MM_CORE;
    if (!v) throw new Error("no core config: not in Tauri and VITE_MM_CORE is unset");
    cfg = parseCoreEnv(v);
  }
  g.__MM_CORE__ = cfg;
  return cfg;
};

let shared: CoreClient | null = null;

/** The process-wide client (created and started on first use). */
export function core(opts: Omit<ClientOptions, "config"> = {}): CoreClient {
  if (!shared) {
    shared = new CoreClient({ role: "ui", ...opts, config: coreConfig });
    void shared.start().catch(() => { /* status() carries it */ });
  }
  return shared;
}

export function createStores(client: CoreClient = core()) {
  return { player: createPlayerStore(client), library: createLibraryStore(client) };
}

/** The connection `status` as a Solid signal (connecting | ready | reconnecting | failed). */
export function createStatusSignal(client: CoreClient = core()): Accessor<Status> {
  const [status, setStatus] = createSignal<Status>(client.status);
  client.onStatus(setStatus);
  return status;
}
