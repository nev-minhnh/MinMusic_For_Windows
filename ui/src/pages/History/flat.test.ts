import { describe, expect, it } from "vitest";
import { HEAD_H, TRACK_H, flatAtY, flatCount, flatOfTrack, heightOf, normalizeGroups, rowAt, topOf, totalHeight, trackRange, type Group } from "./flat";

// 10 tracks: today 0..2, yesterday 3..4, week 5..9
const G: Group[] = [
  { label: "w2_hist_today", offset: 0 },
  { label: "w2_hist_yesterday", offset: 3 },
  { label: "w2_hist_week", offset: 5 },
];
const TOTAL = 10;

describe("history group header placement", () => {
  it("counts rows and height", () => {
    expect(flatCount(TOTAL, G)).toBe(13);
    expect(totalHeight(TOTAL, G)).toBe(10 * TRACK_H + 3 * HEAD_H);
  });

  it("places the header of group k at offset + k", () => {
    const heads = Array.from({ length: flatCount(TOTAL, G) }, (_, f) => rowAt(f, G)).flatMap((r, f) => (r.kind === "head" ? [f] : []));
    expect(heads).toEqual([0, 4, 7]);
  });

  it("maps flat rows to tracks and back", () => {
    expect(rowAt(0, G)).toEqual({ kind: "head", group: 0 });
    expect(rowAt(1, G)).toEqual({ kind: "track", index: 0 });
    expect(rowAt(3, G)).toEqual({ kind: "track", index: 2 });
    expect(rowAt(4, G)).toEqual({ kind: "head", group: 1 });
    expect(rowAt(5, G)).toEqual({ kind: "track", index: 3 });
    expect(rowAt(12, G)).toEqual({ kind: "track", index: 9 });
    for (let i = 0; i < TOTAL; i++) expect(rowAt(flatOfTrack(i, G), G)).toEqual({ kind: "track", index: i });
  });

  it("works without groups (sorted by title: the core sends none)", () => {
    expect(rowAt(7, [])).toEqual({ kind: "track", index: 7 });
    expect(topOf(7, [])).toBe(7 * TRACK_H);
    expect(flatAtY(7 * TRACK_H + 1, 50, [])).toBe(7);
  });

  it("topOf is the sum of the heights above", () => {
    let y = 0;
    for (let f = 0; f < flatCount(TOTAL, G); f++) {
      expect(topOf(f, G)).toBe(y);
      y += heightOf(f, G);
    }
    expect(y).toBe(totalHeight(TOTAL, G));
  });

  it("flatAtY finds the row under a y position, on every edge", () => {
    for (let f = 0; f < flatCount(TOTAL, G); f++) {
      const top = topOf(f, G);
      expect(flatAtY(top, TOTAL, G)).toBe(f);
      expect(flatAtY(top + heightOf(f, G) - 1, TOTAL, G)).toBe(f);
    }
    expect(flatAtY(-50, TOTAL, G)).toBe(0);
    expect(flatAtY(1e9, TOTAL, G)).toBe(flatCount(TOTAL, G) - 1);
  });

  it("trackRange covers the tracks of a flat window", () => {
    expect(trackRange(0, 13, G)).toEqual([0, 10]);
    expect(trackRange(4, 7, G)).toEqual([3, 5]); // header, two tracks of "yesterday"
    expect(trackRange(1, 2, G)).toEqual([0, 1]);
  });

  it("normalizeGroups sorts, dedupes and drops groups outside the list", () => {
    const messy: Group[] = [
      { label: "w2_hist_week", offset: 5 },
      { label: "w2_hist_today", offset: 0 },
      { label: "w2_hist_today", offset: 0 },
      { label: "w2_hist_today", offset: 2 }, // same label as its neighbour: a chunk boundary, not a new group
      { label: "w2_hist_older", offset: 40 },
    ];
    expect(normalizeGroups(messy, TOTAL)).toEqual([
      { label: "w2_hist_today", offset: 0 },
      { label: "w2_hist_week", offset: 5 },
    ]);
  });
});
