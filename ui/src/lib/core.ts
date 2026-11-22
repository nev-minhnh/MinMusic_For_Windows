// Single import point for the core client. Real client (ui/src/core, M0-D) when a core is configured
// (Tauri, or VITE_MM_CORE from mock-core/bin/dev.mjs); otherwise the offline stub in ../stub.
import { core as realCore, artUrl as realArtUrl } from "../core/index";
import * as stub from "../stub";
import type { Client, Art } from "./types";

const real = !!(import.meta.env.VITE_MM_CORE || (globalThis as any).__TAURI_INTERNALS__);

const base: Client = real
  ? {
      call: (m, p) => realCore().call(m as any, p) as Promise<any>,
      sub: (topic, params, onEvent) => realCore().sub(topic as any, (ev, payload) => onEvent(ev, payload), params),
    }
  : stub.client;

/** Dev and e2e builds (VITE_E2E=1): every call is recorded in window.__mmCalls, and window.__mmMock[method](params) may answer a call (test seam). */
export const devBuild = !!(import.meta.env.DEV || import.meta.env.VITE_E2E);
const calls: { m: string; p: unknown }[] = [];
if (devBuild) (window as any).__mmCalls = calls;

export const client: Client = devBuild
  ? {
      call: (m, p) => {
        calls.push({ m, p });
        const o = (window as any).__mmMock?.[m];
        if (o) {
          try {
            return Promise.resolve(o(p));
          } catch (e) {
            return Promise.reject(e);
          }
        }
        return base.call(m, p);
      },
      sub: base.sub,
    }
  : base;

export const artUrl = (art: Art | undefined, cssPx: number): string => (real ? realArtUrl(art as any, cssPx) : stub.artUrl(art, cssPx));
