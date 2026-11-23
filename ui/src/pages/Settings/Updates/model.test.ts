import { describe, expect, it } from "vitest";
import { channelOf, formatSize, noteParagraphs, viewOf, type UpdateStatus } from "./model";

const base: UpdateStatus = { channel: "stable", state: "idle", currentVersion: "2.0.0", portable: false };

describe("viewOf", () => {
  it("never checked", () => {
    const v = viewOf(base);
    expect(v.headline).toBe("never");
    expect(v.canCheck).toBe(true);
    expect(v.canInstall).toBe(false);
  });
  it("up to date after a check", () => {
    expect(viewOf({ ...base, lastCheck: 1 }).headline).toBe("uptodate");
  });
  it("available -> install enabled", () => {
    const v = viewOf({ ...base, lastCheck: 1, available: { version: "2.0.1", notes: "" } });
    expect(v.headline).toBe("available");
    expect(v.canInstall).toBe(true);
    expect(v.showReleasePage).toBe(false);
  });
  it("portable never installs, offers the release page", () => {
    const v = viewOf({ ...base, portable: true, available: { version: "2.0.1", notes: "" } });
    expect(v.canInstall).toBe(false);
    expect(v.showReleasePage).toBe(true);
  });
  it("downloading is busy and shows a clamped percent", () => {
    const v = viewOf({ ...base, state: "downloading", progress: 1.4, available: { version: "2.0.1", notes: "" } });
    expect(v.busy).toBe(true);
    expect(v.canCheck).toBe(false);
    expect(v.canInstall).toBe(false);
    expect(v.percent).toBe(100);
    expect(viewOf({ ...base, state: "downloading", progress: 0.256 }).percent).toBe(26);
  });
  it("error keeps check enabled", () => {
    const v = viewOf({ ...base, state: "error", error: "x" });
    expect(v.headline).toBe("error");
    expect(v.canCheck).toBe(true);
  });
  it("no status yet disables everything", () => {
    const v = viewOf(undefined);
    expect(v.canCheck || v.canInstall).toBe(false);
  });
});

describe("noteParagraphs", () => {
  it("splits on blank lines and drops markdown markers", () => {
    const md = "## What's new\n\n- **Faster** startup\n- `core` fix\n\nSee [the notes](https://x.test/a).";
    expect(noteParagraphs(md)).toEqual(["What's new", "• Faster startup\n• core fix", "See the notes."]);
  });
  it("leaves html as text (it is rendered as a text node, never as markup)", () => {
    expect(noteParagraphs("<img src=x onerror=alert(1)>")).toEqual(["<img src=x onerror=alert(1)>"]);
  });
  it("empty input gives no paragraphs", () => {
    expect(noteParagraphs("  \n\n ")).toEqual([]);
  });
});

describe("misc", () => {
  it("channel mapping", () => {
    expect(channelOf("")).toBe("stable");
    expect(channelOf(undefined)).toBe("stable");
    expect(channelOf("prerelease")).toBe("prerelease");
    expect(channelOf("nightly")).toBe("prerelease");
  });
  it("size", () => {
    expect(formatSize(73400320)).toBe("70 MB");
    expect(formatSize(1572864)).toBe("1.5 MB");
    expect(formatSize(undefined)).toBe("");
  });
});
