// Log viewer helpers (pure, unit tested in logParse.test.ts).
export type Level = "debug" | "info" | "warn" | "error";
export const LEVELS: Level[] = ["debug", "info", "warn", "error"];
export const ROW_H = 18;

const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const RE = /\b(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|SEVERE)\b/;

/** Level of one line, or null for a continuation line (stack frame, wrapped text). Looked up in the first 48 chars only. */
export function lineLevel(line: string): Level | null {
  const m = RE.exec(line.slice(0, 48));
  if (!m) return null;
  switch (m[1]) {
    case "TRACE":
    case "DEBUG":
      return "debug";
    case "INFO":
      return "info";
    case "WARN":
    case "WARNING":
      return "warn";
    default:
      return "error";
  }
}

/** Splits the tail into lines (no trailing empty one) and tags each with its level; continuation lines inherit the previous level. */
export function parseLog(text: string): { text: string; level: Level }[] {
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  let cur: Level = "info";
  return lines.map((l) => {
    cur = lineLevel(l) ?? cur;
    return { text: l, level: cur };
  });
}

/** Minimum-level filter: "info" keeps info, warn and error. `null` keeps everything. */
export function filterLevel<T extends { level: Level }>(rows: T[], min: Level | null): T[] {
  if (!min || min === "debug") return rows;
  return rows.filter((r) => RANK[r.level] >= RANK[min]);
}

/** Rows to render for a scrollTop: the visible ones plus one viewport of overscan on each side. */
export function windowOf(scrollTop: number, viewH: number, total: number, rowH = ROW_H): { start: number; end: number } {
  const v = Math.ceil(viewH / rowH) + 1;
  const first = Math.floor(scrollTop / rowH);
  return { start: Math.max(0, first - v), end: Math.min(total, first + 2 * v) };
}
