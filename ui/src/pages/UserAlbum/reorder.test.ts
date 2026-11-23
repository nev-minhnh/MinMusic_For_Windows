import { describe, expect, it } from "vitest";
import { errorCode, reorderIndex } from "./reorder";

const H = 56;
describe("user album reorder index translation", () => {
  it("rounds the pointer to the nearest gap between rows", () => {
    expect(reorderIndex(5, 0, 10, H).gap).toBe(0);
    expect(reorderIndex(5, 27, 10, H).gap).toBe(0); // upper half of row 0
    expect(reorderIndex(5, 29, 10, H).gap).toBe(1);
    expect(reorderIndex(5, 10_000, 10, H).gap).toBe(10); // below the last row
    expect(reorderIndex(5, -40, 10, H).gap).toBe(0);
  });

  it("moving down: the row ends up one lower than the gap, because it leaves its old place first", () => {
    expect(reorderIndex(2, 6 * H, 10, H)).toEqual({ gap: 6, to: 5 });
    expect(reorderIndex(0, 10 * H, 10, H)).toEqual({ gap: 10, to: 9 });
  });

  it("moving up: the gap is the new index", () => {
    expect(reorderIndex(7, 2 * H, 10, H)).toEqual({ gap: 2, to: 2 });
  });

  it("dropping next to its own place is a no-op (to === from)", () => {
    expect(reorderIndex(4, 4 * H, 10, H).to).toBe(4);
    expect(reorderIndex(4, 5 * H, 10, H).to).toBe(4);
  });
});

describe("error code", () => {
  it("reads the code of an RpcError-like value", () => {
    expect(errorCode({ code: "conflict" })).toBe("conflict");
    expect(errorCode(new Error("x"))).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
  });
});
