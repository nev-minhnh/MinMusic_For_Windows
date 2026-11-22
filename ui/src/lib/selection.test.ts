// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createSelection } from "./selection";
import { handleEsc, escDepth } from "./esc";

const keys = ["a", "b", "c", "d", "e", "f"];
const make = (onPlay?: (k: string[]) => void) => createSelection(() => keys, { onPlay });
const key = (k: string, ctrlKey = false) => ({ key: k, ctrlKey, metaKey: false, altKey: false, shiftKey: false });

describe("selection", () => {
  it("click selects one and replaces the previous", () => {
    const s = make();
    s.click("b");
    s.click("d");
    expect(s.keys()).toEqual(["d"]);
    s.clear();
  });
  it("ctrl+click toggles", () => {
    const s = make();
    s.click("a");
    s.click("c", { ctrlKey: true });
    s.click("e", { ctrlKey: true });
    expect(s.keys()).toEqual(["a", "c", "e"]);
    s.click("c", { ctrlKey: true });
    expect(s.keys()).toEqual(["a", "e"]);
    s.clear();
  });
  it("shift+click selects the range from the anchor, in both directions, and keeps the anchor", () => {
    const s = make();
    s.click("b");
    s.click("e", { shiftKey: true });
    expect(s.keys()).toEqual(["b", "c", "d", "e"]);
    s.click("a", { shiftKey: true });
    expect(s.keys()).toEqual(["a", "b"]);
    s.clear();
  });
  it("ctrl+shift adds the range to the existing selection", () => {
    const s = make();
    s.click("a");
    s.click("c", { ctrlKey: true });
    s.click("e", { ctrlKey: true, shiftKey: true });
    expect(s.keys()).toEqual(["a", "c", "d", "e"]);
    s.clear();
  });
  it("Ctrl A selects all, Enter plays the selection", () => {
    const play = vi.fn();
    const s = make(play);
    expect(s.onKeyDown(key("a", true))).toBe(true);
    expect(s.count()).toBe(6);
    expect(s.onKeyDown(key("Enter"))).toBe(true);
    expect(play).toHaveBeenCalledWith(keys);
    s.clear();
  });
  it("Enter with nothing selected is not taken", () => {
    const s = make(vi.fn());
    expect(s.onKeyDown(key("Enter"))).toBe(false);
  });
  it("is one Esc-stack layer while non-empty; Esc clears it", () => {
    const base = escDepth();
    const s = make();
    expect(escDepth()).toBe(base);
    s.click("a");
    s.click("b", { ctrlKey: true });
    expect(escDepth()).toBe(base + 1);
    expect(handleEsc()).toBe(true);
    expect(s.count()).toBe(0);
    expect(escDepth()).toBe(base);
    expect(handleEsc()).toBe(false);
  });
});
