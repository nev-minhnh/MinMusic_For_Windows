// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { commandFor, hasCommand, KEYMAP } from "./keys";

type M = Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }>;
const ev = (key: string, m: M = {}) => ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...m });
const cmd = (key: string, m: M = {}) => commandFor(ev(key, m))?.cmd ?? null;

describe("key map (frontend-spec 7)", () => {
  it("transport", () => {
    expect(cmd(" ")).toBe("player.toggle");
    expect(commandFor(ev("ArrowLeft"))).toMatchObject({ cmd: "seek.rel", arg: "-1" });
    expect(commandFor(ev("ArrowRight"))).toMatchObject({ cmd: "seek.rel", arg: "1" });
    expect(commandFor(ev("ArrowUp"))).toMatchObject({ cmd: "volume.rel", arg: "1" });
    expect(commandFor(ev("-"))).toMatchObject({ cmd: "volume.rel", arg: "-1" });
    expect(commandFor(ev("+", { shiftKey: true }))).toMatchObject({ cmd: "volume.rel", arg: "1" });
    expect(cmd("m")).toBe("player.mute");
    expect(commandFor(ev("0"))).toMatchObject({ cmd: "seek.pct", arg: "0" });
    expect(commandFor(ev("9"))).toMatchObject({ cmd: "seek.pct", arg: "90" });
    expect(cmd("ArrowRight", { ctrlKey: true })).toBe("player.next");
    expect(cmd("n")).toBe("player.next");
    expect(cmd("ArrowLeft", { ctrlKey: true })).toBe("player.prev");
    expect(cmd("p")).toBe("player.prev");
    expect(cmd("s")).toBe("player.shuffle");
    expect(cmd("R")).toBe("player.repeat");
  });
  it("panes, search, navigation", () => {
    expect(cmd("t")).toBe("fullPlayer.toggle");
    expect(cmd("l")).toBe("pane.lyrics");
    expect(cmd("q")).toBe("pane.queue");
    expect(cmd("d")).toBe("pane.deviceConnect");
    expect(cmd("c")).toBe("video.captions");
    expect(cmd("v")).toBe("video.mode");
    expect(cmd("f")).toBe("window.fullscreen");
    expect(cmd("k", { ctrlKey: true })).toBe("search.focus");
    expect(cmd("f", { ctrlKey: true })).toBe("search.focus");
    expect(cmd("/")).toBe("search.focus");
    expect(cmd(",", { ctrlKey: true })).toBe("settings.open");
    expect(cmd("`", { ctrlKey: true })).toBe("shortcuts.sheet");
    expect(cmd("/", { ctrlKey: true })).toBe("shortcuts.sheet");
    expect(cmd("L", { ctrlKey: true, shiftKey: true })).toBe("logs.open");
    expect(cmd("m", { ctrlKey: true })).toBe("mini.open");
    expect(cmd("b", { ctrlKey: true })).toBe("sidebar.toggle");
    expect(cmd("e", { ctrlKey: true })).toBe("equalizer.open");
    expect(cmd("F11")).toBe("fullscreen.toggle");
    expect(cmd("F5")).toBe("page.refresh");
    expect(cmd("ArrowLeft", { altKey: true })).toBe("nav.back");
    expect(cmd("ArrowRight", { altKey: true })).toBe("nav.forward");
  });
  it("item commands", () => {
    expect(cmd("l", { ctrlKey: true })).toBe("track.like");
    expect(cmd("i", { ctrlKey: true })).toBe("track.info");
    expect(cmd("c", { ctrlKey: true })).toBe("link.copy");
    expect(cmd("Delete")).toBe("page.delete");
    expect(cmd("F2")).toBe("page.rename");
    expect(cmd("q", { ctrlKey: true })).toBe("app.quit");
  });
  it("Ctrl+Shift+L is not Ctrl+L, and unmapped keys map to nothing", () => {
    expect(cmd("l", { ctrlKey: true })).toBe("track.like");
    expect(cmd("x")).toBeNull();
    expect(cmd("Backspace")).toBeNull();
  });
  it("every command id in the map is registered by input/commands/*.ts", () => {
    for (const k of KEYMAP) expect(hasCommand(k.cmd), k.cmd).toBe(true);
  });
});
