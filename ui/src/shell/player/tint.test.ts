import { describe, expect, it } from "vitest";
import { clampTint, lstar, tintFor } from "./tint";

describe("tint", () => {
  it("measures L*", () => {
    expect(lstar("#000000")).toBeCloseTo(0, 1);
    expect(lstar("#ffffff")).toBeCloseTo(100, 0);
    expect(lstar("#777777")).toBeCloseTo(50, 0);
  });
  it("clamps every bright colour to L* <= 20 and leaves dark ones alone", () => {
    for (const c of ["#ffffff", "#ff0000", "#00ff00", "#ffff00", "#a6e3a1", "#5b7cfa", "#e08aa6", "#c9b458", "#808080"]) {
      expect(lstar(clampTint(c)), c).toBeLessThanOrEqual(20.6);
    }
    expect(clampTint("#101820")).toBe("#101820");
    expect(clampTint("#2A1622")).toBe("#2a1622");
  });
  it("keeps the order of the channels when it darkens", () => {
    const out = clampTint("#ff8040");
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
    expect(r!).toBeGreaterThan(g!);
    expect(g!).toBeGreaterThan(b!);
  });
  it("falls back for missing or bad input and is stable per track", () => {
    expect(clampTint(undefined)).toBe("#2A1622");
    expect(clampTint("nope")).toBe("#2A1622");
    expect(tintFor(undefined, "abc")).toBe(tintFor(undefined, "abc"));
    expect(lstar(tintFor("#ffffff", "x"))).toBeLessThanOrEqual(20.6);
  });
});
