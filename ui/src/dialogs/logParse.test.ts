import { describe, expect, it } from "vitest";
import { filterLevel, lineLevel, parseLog, windowOf } from "./logParse";

describe("log parsing", () => {
  it("reads the level near the line start", () => {
    expect(lineLevel("2026-11-23 09:00:00.000 INFO [app] ok")).toBe("info");
    expect(lineLevel("2026-11-23 09:00:00.000 WARN [app] slow")).toBe("warn");
    expect(lineLevel("[ERROR] boom")).toBe("error");
    expect(lineLevel("    at com.x.Y.run(Y.kt:1)")).toBeNull();
    expect(lineLevel("x".repeat(60) + " ERROR late")).toBeNull();
  });
  it("continuation lines inherit the previous level", () => {
    const r = parseLog("t INFO a\nt ERROR b\n    at x\n    at y\nt INFO c\n");
    expect(r.map((x) => x.level)).toEqual(["info", "error", "error", "error", "info"]);
    expect(r).toHaveLength(5);
  });
  it("filters by minimum level", () => {
    const r = parseLog("t INFO a\nt WARN b\nt ERROR c");
    expect(filterLevel(r, null)).toHaveLength(3);
    expect(filterLevel(r, "info")).toHaveLength(3);
    expect(filterLevel(r, "warn").map((x) => x.text)).toEqual(["t WARN b", "t ERROR c"]);
    expect(filterLevel(r, "error")).toHaveLength(1);
  });
  it("renders a bounded window of fixed 18 px rows", () => {
    const w = windowOf(0, 360, 2000);
    expect(w.start).toBe(0);
    expect(w.end - w.start).toBeLessThan(90);
    const mid = windowOf(18 * 1000, 360, 2000);
    expect(mid.start).toBeLessThan(1000);
    expect(mid.end).toBeGreaterThan(1020);
    expect(windowOf(18 * 5000, 360, 2000).end).toBe(2000);
  });
});
