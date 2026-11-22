// api.md §1.5
export type ErrorCode =
  | "bad_request" | "not_found" | "unauthorized" /* token */ | "not_signed_in" | "vip_required"
  | "region_blocked" | "source_disabled" | "source_degraded" | "network" | "rate_limited"
  | "timeout" | "conflict" /* stale revision */ | "busy" | "unsupported" | "cancelled" | "internal";

export interface ApiError {
  code: ErrorCode;
  /** English, for logs */
  msg: string;
  /** string key */
  i18n?: string;
  args?: string[];
  retryable: boolean;
  /** `details.sourceId` is set for source errors */
  details?: { sourceId?: string; [k: string]: unknown };
}

export const ERROR_CODES: readonly ErrorCode[] = [
  "bad_request", "not_found", "unauthorized", "not_signed_in", "vip_required",
  "region_blocked", "source_disabled", "source_degraded", "network", "rate_limited",
  "timeout", "conflict", "busy", "unsupported", "cancelled", "internal",
];

/** Thrown by the client when a call completes with `e`. */
export class RpcError extends Error {
  readonly error: ApiError;
  constructor(error: ApiError) {
    super(`${error.code}: ${error.msg}`);
    this.name = "RpcError";
    this.error = error;
  }
  get code(): ErrorCode { return this.error.code; }
  get retryable(): boolean { return this.error.retryable; }
}

/** WebSocket close code used when the token is bad or hello is late (api.md §1.3). */
export const CLOSE_UNAUTHORIZED = 4401;
