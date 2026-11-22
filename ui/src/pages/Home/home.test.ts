import { describe, expect, it } from "vitest";
import { mergeShelves, quickCols, trendText } from "./home";
import type { Shelf } from "../../lib/types";

const sh = (key: string, n = 0): Shelf => ({ key, title: key, layout: "cards", items: Array.from({ length: n }, () => ({}) as never) });

describe("home helpers", () => {
  it("quick pick columns: clamp(floor(W/280),3,6), 2 compact, 3 medium", () => {
    expect(quickCols(1600, "expanded")).toBe(5);
    expect(quickCols(1248, "expanded")).toBe(4);
    expect(quickCols(700, "expanded")).toBe(3);
    expect(quickCols(3000, "expanded")).toBe(6);
    expect(quickCols(2000, "compact")).toBe(2);
    expect(quickCols(2000, "medium")).toBe(3);
  });
  it("home.updated swaps shelves by key in place and appends new keys", () => {
    const out = mergeShelves([sh("a", 1), sh("b", 1), sh("c", 1)], [sh("b", 5), sh("d", 2)]);
    expect(out.map((s) => s.key)).toEqual(["a", "b", "c", "d"]);
    expect(out[1].items).toHaveLength(5);
    expect(out[0].items).toHaveLength(1);
  });
  it("trend text", () => {
    expect(trendText({ trend: "up", delta: 3 })).toBe("▲ 3");
    expect(trendText({ trend: "down", delta: 2 })).toBe("▼ 2");
    expect(trendText({ trend: "same" })).toBe("–");
    expect(trendText({ trend: "new" })).toBe("new");
  });
});
