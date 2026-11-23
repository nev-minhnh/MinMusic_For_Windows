// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// the shared core client is replaced so the test can push `player` events and see the calls
const calls: { m: string; p?: unknown }[] = [];
let emit: (ev: string, p: unknown) => void = () => {};
vi.mock("../lib/core", () => ({
  devBuild: false,
  client: {
    call: (m: string, p?: unknown) => (calls.push({ m, p }), Promise.resolve({})),
    sub: (_t: string, _p: unknown, cb: (ev: string, p: unknown) => void) => ((emit = cb), () => {}),
  },
  artUrl: () => "grad:g3",
}));

const invoked: { cmd: string; args?: unknown }[] = [];
let dispose: () => void = () => {};
afterEach(() => dispose());
beforeEach(() => {
  calls.length = 0;
  invoked.length = 0;
  (window as any).__TAURI_INTERNALS__ = { invoke: (cmd: string, args?: unknown) => (invoked.push({ cmd, args }), Promise.resolve()) };
  document.body.innerHTML = '<div id="r"></div>';
  location.hash = "#/mini";
});

const state = (o: object = {}) => ({
  track: { id: "t1", title: "Nơi Này Có Anh", artists: [{ name: "Sơn Tùng M-TP" }], art: { src: "grad:g3" }, source: "yt" },
  playing: true, buffering: false, reconnecting: false, posMs: 1000, durMs: 200000, bufMs: 0, at: 0, volume: 1, muted: false,
  shuffle: false, repeat: "off", speed: 1, pitch: 1, eq: { enabled: false, profileName: "" }, canPrev: true, canNext: false, ...o,
});

async function mount() {
  const { render } = await import("solid-js/web");
  const { initPlayer } = await import("../state/player");
  const { MiniApp } = await import("./MiniApp");
  initPlayer();
  dispose = render(() => MiniApp(), document.getElementById("r")!);
  emit("player.snapshot", state());
  await Promise.resolve();
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

describe("MiniApp", () => {
  it("renders the track and follows the player state", async () => {
    await mount();
    expect(q("mini-title").textContent).toBe("Nơi Này Có Anh");
    expect(q("mini").dataset.mode).toBe("bar");
    expect((q("mini-prev") as HTMLButtonElement).disabled).toBe(false);
    expect((q("mini-next") as HTMLButtonElement).disabled).toBe(true);
    expect(q("mini-play").getAttribute("aria-label")).toBe("Pause");
    emit("player.state", state({ playing: false }));
    expect(q("mini-play").getAttribute("aria-label")).toBe("Play");
    expect(document.querySelector(".mini-line .bar.line")).not.toBeNull();
  });

  it("controls call the player; the mode button asks the shell", async () => {
    await mount();
    q("mini-play").click();
    q("mini-prev").click();
    expect(calls.map((c) => c.m)).toEqual(["player.toggle", "player.prev"]);
    q("mini-mode").click();
    expect(invoked).toContainEqual({ cmd: "mini_set_mode", args: { mode: "square" } });
    expect(q("mini").dataset.mode).toBe("square");
  });

  it("double click, Esc and Ctrl M go back to the main window", async () => {
    await mount();
    q("mini").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", ctrlKey: true }));
    expect(invoked.filter((i) => i.cmd === "mini_toggle")).toHaveLength(3);
    q("mini-play").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(invoked.filter((i) => i.cmd === "mini_toggle")).toHaveLength(3); // controls do not trigger it
  });

  it("square mode from the URL", async () => {
    const { modeFromHash } = await import("./MiniApp");
    expect(modeFromHash("#/mini")).toBe("bar");
    expect(modeFromHash("#/mini?mode=square")).toBe("square");
  });
});

describe("Ctrl M", () => {
  it("is mapped to mini.open, which opens the mini window through the shell", async () => {
    const { commandFor, runCommand } = await import("../input/keys");
    expect(commandFor({ key: "m", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })?.cmd).toBe("mini.open");
    runCommand("mini.open");
    expect(invoked.filter((i) => i.cmd !== "core_config")).toEqual([{ cmd: "mini_toggle", args: undefined }]);
  });
});
