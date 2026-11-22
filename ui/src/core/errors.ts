// Error helpers for UI code that surfaces core errors (toasts, retry actions).
import { RpcError } from "@minmusic/protocol";

/** `cancelled` is the normal answer to a superseded call (search.suggest, a page left mid-load): never show it. */
export function isCancelled(e: unknown): boolean {
  return e instanceof RpcError && e.code === "cancelled";
}

/** Whether an error from `core.call` deserves a toast. Cancelled calls are silent; everything else is shown. */
export function shouldToast(e: unknown): boolean {
  return !isCancelled(e);
}

/** Retry action ("Thử lại") only for errors the core marks retryable. */
export function canRetry(e: unknown): boolean {
  return e instanceof RpcError && e.retryable;
}
