import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "@minmusic/protocol";
import { __seedSettings, applyTheme, setSecret, setSetting, settingFailure, settingValue, themeAttr } from "./settings";

const E: SettingEntry[] = [
  { key: "hideExplicit", type: "bool", default: false, platform: "all" },
  { key: "seekDurationSeconds", type: "int", default: 10, min: 1, max: 60, step: 1, platform: "all" },
  { key: "lyricsAiApiKey", type: "secret", default: { set: false }, platform: "all" },
];
type W = typeof window & { __mmMock?: Record<string, (p: any) => unknown> };

describe("settings store", () => {
  beforeEach(() => __seedSettings(E, { hideExplicit: false, seekDurationSeconds: 10, lyricsAiApiKey: { set: false } }));
  afterEach(() => {
    delete (window as W).__mmMock;
    vi.useRealTimers();
  });

  it("settingValue falls back to the schema default", () => {
    __seedSettings(E, {});
    expect(settingValue("seekDurationSeconds")).toBe(10);
  });

  it("set is optimistic: the new value is visible before the core answers, and kept on success", async () => {
    let release!: () => void;
    const seen: unknown[] = [];
    (window as W).__mmMock = {
      "settings.set": (p) => {
        seen.push(p);
        return new Promise<void>((r) => (release = r));
      },
    };
    const done = setSetting("hideExplicit", true);
    expect(settingValue("hideExplicit")).toBe(true);
    expect(seen).toEqual([{ values: { hideExplicit: true } }]);
    release();
    expect(await done).toBe(true);
    expect(settingValue("hideExplicit")).toBe(true);
  });

  it("a bad_request rolls the value back and flags the row", async () => {
    (window as W).__mmMock = {
      "settings.set": () => {
        throw Object.assign(new Error("range"), { code: "bad_request" });
      },
    };
    expect(await setSetting("seekDurationSeconds", 999)).toBe(false);
    expect(settingValue("seekDurationSeconds")).toBe(10);
    expect(settingFailure()).toEqual({ key: "seekDurationSeconds", code: "bad_request" });
  });

  it("the failure flag clears itself", async () => {
    vi.useFakeTimers();
    (window as W).__mmMock = {
      "settings.set": () => {
        throw new Error("x");
      },
    };
    await setSetting("hideExplicit", true);
    expect(settingFailure()?.key).toBe("hideExplicit");
    vi.advanceTimersByTime(4100);
    expect(settingFailure()).toBeNull();
  });

  it("a secret goes through lyrics.ai.setKey and the store only ever holds {set}", async () => {
    const calls: unknown[] = [];
    (window as W).__mmMock = {
      "lyrics.ai.setKey": (p) => {
        calls.push(p);
        return {};
      },
    };
    expect(await setSecret("lyricsAiApiKey", "OpenRouter", "sk-123")).toBe(true);
    expect(calls).toEqual([{ provider: "OpenRouter", key: "sk-123" }]);
    expect(settingValue("lyricsAiApiKey")).toEqual({ set: true });
    expect(JSON.stringify(settingValue("lyricsAiApiKey"))).not.toContain("sk-123");
    expect(await setSecret("lyricsAiApiKey", "OpenRouter", "")).toBe(true);
    expect(settingValue("lyricsAiApiKey")).toEqual({ set: false });
  });

  it("a refused secret write rolls back", async () => {
    (window as W).__mmMock = {
      "lyrics.ai.setKey": () => {
        throw new Error("down");
      },
    };
    expect(await setSecret("lyricsAiApiKey", "OpenRouter", "k")).toBe(false);
    expect(settingValue("lyricsAiApiKey")).toEqual({ set: false });
  });
});

describe("theme", () => {
  it("maps themeMode to data-theme: PURE_BLACK -> black, AUTO -> none", () => {
    expect(themeAttr("LIGHT")).toBe("light");
    expect(themeAttr("DARK")).toBe("dark");
    expect(themeAttr("PURE_BLACK")).toBe("black");
    expect(themeAttr("AUTO")).toBeNull();
    const el = document.createElement("html");
    applyTheme("PURE_BLACK", el);
    expect(el.dataset.theme).toBe("black");
    applyTheme("AUTO", el);
    expect(el.dataset.theme).toBeUndefined();
  });
});
