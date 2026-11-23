/** The `player.play` payload for a chart: the whole list as `{kind:"tracks", ids, title}`, started at `startIndex` (fixes "only one song plays"). */
export function chartPlay(items: { id: string }[], startIndex: number, title?: string) {
  return { context: { kind: "tracks" as const, ids: items.map((x) => x.id), title }, startIndex };
}

export const trendGlyph = (x: { trend: string }) => (x.trend === "up" ? "▲" : x.trend === "down" ? "▼" : x.trend === "same" ? "–" : "");

