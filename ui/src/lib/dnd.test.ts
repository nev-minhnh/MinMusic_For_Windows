// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { gapIndex, moveTarget, audioPaths, MIME } from "./dnd";

describe("dnd", () => {
  it("payload MIME", () => expect(MIME).toBe("application/x-mm-tracks"));
  it("drop gap is the nearest row boundary, clamped", () => {
    expect(gapIndex(10, 56, 10)).toBe(0);
    expect(gapIndex(30, 56, 10)).toBe(1);
    expect(gapIndex(-50, 56, 10)).toBe(0);
    expect(gapIndex(9999, 56, 10)).toBe(10);
  });
  it("moving down lands one earlier once the row is removed", () => {
    expect(moveTarget(2, 6)).toBe(5);
    expect(moveTarget(5, 1)).toBe(1);
    expect(moveTarget(3, 3)).toBe(3);
    expect(moveTarget(3, 4)).toBe(3);
  });
  it("only audio files are imported", () => {
    expect(audioPaths(["C:\\a\\x.MP3", "C:\\a\\y.txt", "z.flac", "w"])).toEqual(["C:\\a\\x.MP3", "z.flac"]);
  });
});
