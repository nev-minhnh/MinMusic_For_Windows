import { describe, expect, it } from "vitest";
import { chartPlay, trendGlyph } from "./chart";

describe("chartPlay", () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: `t${i}` }));
  it("sends the whole chart as one tracks context with startIndex (not a single id)", () => {
    const p = chartPlay(items, 7, "Zing Chart");
    expect(p.context.kind).toBe("tracks");
    expect(p.context.ids).toHaveLength(100);
    expect(p.context.ids[7]).toBe("t7");
    expect(p.context.title).toBe("Zing Chart");
    expect(p.startIndex).toBe(7);
  });
  it("trend glyphs", () => {
    expect(["up", "down", "same", "new"].map((t) => trendGlyph({ trend: t }))).toEqual(["▲", "▼", "–", ""]);
  });
});
