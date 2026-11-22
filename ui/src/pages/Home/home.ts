// Pure helpers of the Home page (unit tested).
import type { Shelf as ShelfT } from "../../lib/types";

/** `home.updated` swaps shelves by key, in place: matching keys are replaced, new keys are appended, nothing fades. */
export function mergeShelves(cur: ShelfT[], inc: ShelfT[]): ShelfT[] {
  const byKey = new Map(inc.map((s) => [s.key, s]));
  const out = cur.map((s) => byKey.get(s.key) ?? s);
  const have = new Set(cur.map((s) => s.key));
  for (const s of inc) if (!have.has(s.key)) out.push(s);
  return out;
}

/** Quick pick columns: clamp(floor(W/280), 3, 6), or 2 / 3 in compact / medium. */
export function quickCols(contentW: number, cls: "compact" | "medium" | "expanded"): number {
  return cls === "compact" ? 2 : cls === "medium" ? 3 : Math.min(6, Math.max(3, Math.floor(contentW / 280)));
}

export function trendText(x: { trend: string; delta?: number }): string {
  return x.trend === "up" ? `▲ ${x.delta ?? ""}`.trim() : x.trend === "down" ? `▼ ${x.delta ?? ""}`.trim() : x.trend === "same" ? "–" : "new";
}
