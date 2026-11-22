import { describe, it, expect } from "vitest";
import { menuSize, placeRoot, placeSub, MENU_W, EDGE } from "./place";
import { SEP, tidy, type MenuItem } from "./types";

const items: MenuItem[] = [{ id: "a", label: "A" }, { id: "b", label: "B" }, SEP, { id: "c", label: "C" }];
const vp = { w: 1000, h: 700 };

describe("menu placement", () => {
  it("size = padding + 36 per item + 13 per separator", () => {
    expect(menuSize(items)).toEqual({ w: 272, h: 12 + 36 * 3 + 13 });
  });
  it("root opens at the pointer", () => {
    expect(placeRoot({ x: 100, y: 120 }, menuSize(items), vp)).toEqual({ left: 100, top: 120 });
  });
  it("root is clamped at all four edges", () => {
    const s = menuSize(items);
    expect(placeRoot({ x: 990, y: 100 }, s, vp).left).toBe(1000 - EDGE - MENU_W); // right
    expect(placeRoot({ x: 100, y: 690 }, s, vp).top).toBe(700 - EDGE - s.h); // bottom
    expect(placeRoot({ x: -20, y: 100 }, s, vp).left).toBe(EDGE); // left
    expect(placeRoot({ x: 100, y: -5 }, s, vp).top).toBe(EDGE); // top
  });
  const parent = { left: 300, top: 100, right: 572, bottom: 400 };
  const item = { left: 306, top: 136, right: 566, bottom: 172 };
  it("submenu opens to the right of its parent, aligned with the item", () => {
    const p = placeSub(item, parent, { w: 272, h: 120 }, vp);
    expect(p.flipX).toBe(false);
    expect(p.left).toBe(parent.right - 2);
    expect(p.top).toBe(item.top - 6);
  });
  it("submenu flips LEFT when it would overflow the right edge", () => {
    const wide = { left: 700, top: 100, right: 972, bottom: 400 };
    const p = placeSub({ ...item, left: 706, right: 966 }, wide, { w: 272, h: 120 }, vp);
    expect(p.flipX).toBe(true);
    expect(p.left).toBe(wide.left + 2 - 272);
  });
  it("submenu flips UP near the bottom edge (bottom-aligned with the item)", () => {
    const low = { left: 300, top: 400, right: 572, bottom: 690 };
    const it2 = { left: 306, top: 640, right: 566, bottom: 676 };
    const p = placeSub(it2, low, { w: 272, h: 200 }, vp);
    expect(p.flipY).toBe(true);
    expect(p.top + 200).toBe(it2.bottom + 6);
  });
  it("flips both ways in the bottom-right corner and stays inside the window", () => {
    const parent2 = { left: 700, top: 500, right: 972, bottom: 690 };
    const it2 = { left: 706, top: 640, right: 966, bottom: 676 };
    const p = placeSub(it2, parent2, { w: 272, h: 200 }, vp);
    expect(p.flipX && p.flipY).toBe(true);
    expect(p.left).toBeGreaterThanOrEqual(EDGE);
    expect(p.top).toBeGreaterThanOrEqual(EDGE);
  });
  it("a submenu taller than the window is clamped to the top edge", () => {
    const p = placeSub({ left: 306, top: 300, right: 566, bottom: 336 }, parent, { w: 272, h: 900 }, vp);
    expect(p.top).toBe(EDGE);
  });
  it("tidy drops leading, trailing and doubled separators and falsy entries", () => {
    const out = tidy([SEP, { id: "a", label: "A" }, SEP, SEP, false, { id: "b", label: "B" }, SEP]);
    expect(out.map((i) => ("sep" in i ? "-" : i.id))).toEqual(["a", "-", "b"]);
  });
});
