// Pure rules of the Backup page (unit tested in logic.test.ts).
export type Inspect = { ok: boolean; platform: string; dbVersion: number; createdAt?: number; error?: string };

export type RestoreGate = { allow: true } | { allow: false; reason: "invalid" | "android" };

/** The restore confirm dialog enables its button only when the core says the file is a usable MinMusic backup.
 *  An Android backup is a different format: it goes through the import path (import.foreignBackup), never through restore. */
export function restoreGate(i: Inspect): RestoreGate {
  if (!i.ok) return { allow: false, reason: "invalid" };
  if (i.platform.toLowerCase() === "android") return { allow: false, reason: "android" };
  return { allow: true };
}

/** 1536 -> "1.5 KB", 1048576 -> "1.0 MB" */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "-";
  if (n < 1024) return `${Math.round(n)} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}

export function fmtWhen(ms: number | undefined, locale: string): string {
  if (ms === undefined || !Number.isFinite(ms)) return "-";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}
