// api.md §1.2, §1.3
import type { ApiError } from "./errors.ts";

export interface Req { id: number; m: string; p?: object }
/** exactly one of r / e */
export interface Res { id: number; r?: unknown; e?: ApiError }
export interface Evt { ev: string; p: unknown; sub?: number; seq?: number }
export interface SrvReq { sid: number; m: string; p?: object }
export interface SrvRes { sid: number; r?: unknown; e?: ApiError }

export type Role = "ui" | "mini" | "shell";

export interface HelloParams {
  token: string;
  role: Role;
  protocol: 1;
  /** "ui/0.1.0" */
  client: string;
  /** "vi" */
  locale: string;
}
export interface HelloResult {
  protocol: 1;
  /** semver */
  core: string;
  sessionId: string;
  capabilities: string[];
  /** epoch ms */
  serverTime: number;
}

export const PROTOCOL_VERSION = 1 as const;
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;

/** Default client timeouts (api.md §1.2), ms. `null` = no timeout. */
export const TIMEOUT_DEFAULT_MS = 15_000;
export const TIMEOUT_LONG_MS = 20_000;
export function timeoutFor(m: string): number | null {
  if (m === "shell.webLogin") return null;
  if (m.startsWith("search.") || m.endsWith(".page")) return TIMEOUT_LONG_MS;
  return TIMEOUT_DEFAULT_MS;
}

/** The core_config Tauri command result / window.__MM_CORE__ (architecture §4). */
export interface CoreConfig { port: number; token: string; artToken: string }
