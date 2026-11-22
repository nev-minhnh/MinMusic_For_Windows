// Single import point for the core client. Real client (ui/src/core, M0-D) when a core is configured
// (Tauri, or VITE_MM_CORE from mock-core/bin/dev.mjs); otherwise the offline stub in ../stub.
import { core as realCore, artUrl as realArtUrl } from "../core/index";
import * as stub from "../stub";
import type { Client, Art } from "./types";

const real = !!(import.meta.env.VITE_MM_CORE || (globalThis as any).__TAURI_INTERNALS__);

export const client: Client = real
  ? {
      call: (m, p) => realCore().call(m as any, p) as Promise<any>,
      sub: (topic, params, onEvent) => realCore().sub(topic as any, (ev, payload) => onEvent(ev, payload), params),
    }
  : stub.client;

export const artUrl = (art: Art | undefined, cssPx: number): string => (real ? realArtUrl(art as any, cssPx) : stub.artUrl(art, cssPx));
