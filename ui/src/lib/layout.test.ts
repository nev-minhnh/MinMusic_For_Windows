import { describe, it, expect } from "vitest";
import { widthClass, heightClass, plainW } from "./layout";
import { interp } from "../state/player";
import { initial, pushOp, backOp, forwardOp, mountedOf } from "../router/router";
// @ts-ignore
import { decodeXml } from "../../tools/gen-strings.mjs";

describe("layout hysteresis", () => {
  it("plain classes", () => {
    expect(plainW(839)).toBe("compact");
    expect(plainW(840)).toBe("medium");
    expect(plainW(1200)).toBe("expanded");
  });
  it("holds the class inside the 16 px band", () => {
    expect(widthClass(1195, "expanded")).toBe("expanded");
    expect(widthClass(1183, "expanded")).toBe("medium");
    expect(widthClass(1205, "medium")).toBe("medium");
    expect(widthClass(1216, "medium")).toBe("expanded");
    expect(heightClass(750, "regular")).toBe("regular");
    expect(heightClass(743, "regular")).toBe("short");
  });
});
describe("interpolated clock", () => {
  it("advances and clamps", () => {
    expect(interp(1000, 0, 500, 1, 5000)).toBe(1500);
    expect(interp(4900, 0, 500, 1, 5000)).toBe(5000);
    expect(interp(1000, 0, 500, 1, 5000, false)).toBe(1000);
  });
});
describe("router stack", () => {
  it("keep-alive keeps the current page and 4 previous", () => {
    let s = initial();
    for (let i = 0; i < 7; i++) s = pushOp(s, { name: "album", params: { id: String(i) }, key: "k" + i });
    expect(mountedOf(s).length).toBe(5);
    s = backOp(s);
    expect(s.idx).toBe(6);
    expect(forwardOp(s).idx).toBe(7);
  });
});
describe("strings", () => {
  it("converts placeholders and escapes", () => {
    expect(decodeXml("A %1$s \'b\' &amp; %2$d")).toBe("A {0} 'b' & {1}");
  });
});
