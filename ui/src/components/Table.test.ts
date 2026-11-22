// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { visibleCols, gridTemplate, nextSort } from "./Table";
import { ALL_COLS } from "./Row";

describe("table helpers", () => {
  it("hides added below 880 and album below 720", () => {
    expect(visibleCols(ALL_COLS, 1000)).toEqual(ALL_COLS);
    expect(visibleCols(ALL_COLS, 879)).not.toContain("added");
    expect(visibleCols(ALL_COLS, 879)).toContain("album");
    expect(visibleCols(ALL_COLS, 719)).not.toContain("album");
    expect(visibleCols(["index", "title", "dur"], 400)).toEqual(["index", "title", "dur"]);
  });
  it("grid template follows the visible columns", () => {
    expect(gridTemplate(["index", "title", "dur"])).toBe("32px minmax(0,1fr) 40px");
  });
  it("header click flips the same column and starts a new one ascending (added: newest first)", () => {
    expect(nextSort({ by: "title", desc: false }, "title")).toEqual({ by: "title", desc: true });
    expect(nextSort({ by: "title", desc: true }, "album")).toEqual({ by: "album", desc: false });
    expect(nextSort(undefined, "added")).toEqual({ by: "added", desc: true });
  });
});
