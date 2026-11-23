import { describe, expect, it } from "vitest";
import { dropIndex, moveItem, normalizeOrder, shiftOf } from "./reorder";

describe("priority reorder maths", () => {
  it("moveItem moves down, up, clamps and never mutates", () => {
    const a = ["yt", "zing", "nct", "sc"];
    expect(moveItem(a, 0, 2)).toEqual(["zing", "nct", "yt", "sc"]);
    expect(moveItem(a, 3, 0)).toEqual(["sc", "yt", "zing", "nct"]);
    expect(moveItem(a, 1, 99)).toEqual(["yt", "nct", "sc", "zing"]);
    expect(moveItem(a, 1, -5)).toEqual(["zing", "yt", "nct", "sc"]);
    expect(moveItem(a, 9, 0)).toEqual(a);
    expect(a).toEqual(["yt", "zing", "nct", "sc"]);
  });

  it("dropIndex rounds to the nearest row and clamps to the list", () => {
    expect(dropIndex(1, 0, 72, 4)).toBe(1);
    expect(dropIndex(1, 35, 72, 4)).toBe(1);
    expect(dropIndex(1, 37, 72, 4)).toBe(2);
    expect(dropIndex(1, -110, 72, 4)).toBe(0);
    expect(dropIndex(1, 9999, 72, 4)).toBe(3);
    expect(dropIndex(2, -150, 72, 4)).toBe(0);
    expect(dropIndex(2, 10, 0, 4)).toBe(2);
  });

  it("shiftOf moves the rows between the origin and the target by one row", () => {
    // dragging row 0 to 2: rows 1 and 2 move up, row 3 stays
    expect([0, 1, 2, 3].map((i) => shiftOf(i, 0, 2, 72))).toEqual([0, -72, -72, 0]);
    // dragging row 3 to 1: rows 1 and 2 move down
    expect([0, 1, 2, 3].map((i) => shiftOf(i, 3, 1, 72))).toEqual([0, 72, 72, 0]);
    expect([0, 1, 2, 3].map((i) => shiftOf(i, 2, 2, 72))).toEqual([0, 0, 0, 0]);
  });

  it("drag result equals the shifted layout", () => {
    const order = ["yt", "zing", "nct", "sc"];
    const from = 0;
    const to = dropIndex(from, 150, 72, order.length);
    const next = moveItem(order, from, to);
    expect(next).toEqual(["zing", "nct", "yt", "sc"]);
    // every row's final index differs from the start by exactly its shift in rows
    order.forEach((id, i) => {
      const moved = i === from ? to - from : shiftOf(i, from, to, 1);
      expect(next.indexOf(id) - i).toBe(moved);
    });
  });

  it("normalizeOrder keeps a permutation of the known ids", () => {
    expect(normalizeOrder(["nct", "x", "nct", "yt"], ["yt", "sc", "zing", "nct"])).toEqual(["nct", "yt", "sc", "zing"]);
    expect(normalizeOrder([], ["a", "b"])).toEqual(["a", "b"]);
  });
});
