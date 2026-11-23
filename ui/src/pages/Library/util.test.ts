import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextSort } from "../../components/Table";
import { debounce, gridCols, clockText, fmtBytes } from "./util";

describe("filter debounce (150 ms)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires once, with the last value, 150 ms after the last keystroke", () => {
    const fn = vi.fn();
    const d = debounce(fn, 150);
    d("a");
    vi.advanceTimersByTime(100);
    d("ab");
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("ab");
  });

  it("cancel drops the pending call", () => {
    const fn = vi.fn();
    const d = debounce(fn, 150);
    d("x");
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("sort toggling by header click", () => {
  it("a new column starts ascending, date added newest first", () => {
    expect(nextSort({ by: "added", desc: true }, "title")).toEqual({ by: "title", desc: false });
    expect(nextSort({ by: "title", desc: false }, "added")).toEqual({ by: "added", desc: true });
  });
  it("the same column flips direction", () => {
    expect(nextSort({ by: "title", desc: false }, "title")).toEqual({ by: "title", desc: true });
    expect(nextSort({ by: "title", desc: true }, "title")).toEqual({ by: "title", desc: false });
  });
});

describe("card grid columns", () => {
  it("floor((W + gap) / (card + gap)), at least 1 (MK 4)", () => {
    expect(gridCols(1000, 168, 24)).toBe(5); // 1024 / 192
    expect(gridCols(1088, 184, 24)).toBe(5);
    expect(gridCols(100, 184, 24)).toBe(1);
  });
});

describe("text helpers", () => {
  it("formats clock time and sizes", () => {
    expect(clockText(new Date(2026, 10, 20, 9, 5).getTime())).toBe("09:05");
    expect(fmtBytes(6_200_000_000)).toBe("6,2 GB");
    expect(fmtBytes(4_100_000)).toBe("4,1 MB");
  });
});
