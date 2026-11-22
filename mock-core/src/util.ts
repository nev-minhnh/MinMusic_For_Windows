// Small helpers shared by the mock core and its handler modules.
import type { ApiError, ErrorCode } from "@minmusic/protocol";

export class ApiErr extends Error {
  readonly err: ApiError;
  constructor(code: ErrorCode, msg: string, extra: Partial<ApiError> = {}) {
    super(msg);
    this.err = { code, msg, retryable: false, ...extra };
  }
}
export const bad = (msg: string) => new ApiErr("bad_request", msg);
export const notFound = (msg: string) => new ApiErr("not_found", msg);

export function isObj(v: unknown): v is Record<string, any> { return typeof v === "object" && v !== null && !Array.isArray(v); }
export function reqNum(p: any, k: string, min = -Infinity, max = Infinity): number {
  const v = p?.[k];
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw bad(`${k}: number in [${min}, ${max}] required`);
  return v;
}
export function reqInt(p: any, k: string, min = -Infinity, max = Infinity): number {
  const v = reqNum(p, k, min, max);
  if (!Number.isInteger(v)) throw bad(`${k}: integer required`);
  return v;
}
export function reqBool(p: any, k: string): boolean {
  if (typeof p?.[k] !== "boolean") throw bad(`${k}: boolean required`);
  return p[k];
}
export function reqStr(p: any, k: string): string {
  if (typeof p?.[k] !== "string" || p[k] === "") throw bad(`${k}: non-empty string required`);
  return p[k];
}
export function reqStrArr(p: any, k: string): string[] {
  if (!Array.isArray(p?.[k]) || p[k].some((x: unknown) => typeof x !== "string")) throw bad(`${k}: string[] required`);
  return p[k];
}

export function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** lower-case, diacritics stripped (vi), for text filters and search */
export const strip = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** cursor helpers: opaque to clients, "<tag>:<n>" here */
export function parseCursor(c: unknown, tag: string): number {
  if (c === undefined || c === null || c === "") return 0;
  if (typeof c !== "string") throw bad("cursor: string required");
  const m = new RegExp(`^${tag}:(\d{1,6})$`).exec(c);
  if (!m) throw bad("stale cursor");
  return Number(m[1]);
}
