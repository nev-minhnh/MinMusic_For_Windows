// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createSelection } from "../lib/selection";
import { handleEsc, pushEsc, escDepth } from "../lib/esc";
import { openMenu, closeMenu, menuOpen } from "./Menu";

describe("Esc order: menu, dialog, selection, back", () => {
  it("peels one layer per press", () => {
    const base = escDepth();
    const s = createSelection(() => ["a", "b"]);
    s.click("a"); // selection layer
    let dialog = true;
    const popDialog = pushEsc(() => (dialog = false)); // a dialog opened over it
    openMenu([{ id: "x", label: "X" }], { x: 10, y: 10 }); // a context menu over the dialog
    expect(menuOpen()).toBe(true);

    expect(handleEsc()).toBe(true);
    expect(menuOpen()).toBe(false);
    expect(dialog).toBe(true);
    expect(s.count()).toBe(1);

    expect(handleEsc()).toBe(true);
    expect(dialog).toBe(false);
    popDialog();
    expect(s.count()).toBe(1);

    expect(handleEsc()).toBe(true);
    expect(s.count()).toBe(0);

    // nothing left: keys.ts now falls through to "back"
    expect(handleEsc()).toBe(false);
    expect(escDepth()).toBe(base);
    closeMenu();
  });
});
