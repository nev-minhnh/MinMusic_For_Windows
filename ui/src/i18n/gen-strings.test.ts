import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-ignore plain mjs tool
import { mergeExtra, loadExtra } from "../../tools/gen-strings.mjs";

describe("gen-strings extra merge", () => {
  it("merges every extra/<locale>/*.json plus extra/<locale>.json", () => {
    const d = mkdtempSync(join(tmpdir(), "mm-extra-"));
    mkdirSync(join(d, "en"));
    writeFileSync(join(d, "en.json"), JSON.stringify({ w2_a: "A" }));
    writeFileSync(join(d, "en", "m1-3b.json"), JSON.stringify({ w2_b: "B" }));
    writeFileSync(join(d, "en", "m1-3c.json"), JSON.stringify({ w2_c: "C" }));
    expect(loadExtra(d, "en")).toEqual({ w2_a: "A", w2_b: "B", w2_c: "C" });
    expect(loadExtra(d, "vi")).toEqual({});
  });
  it("fails on a key clash and names both files", () => {
    expect(() => mergeExtra([{ file: "extra/en/m1-3b.json", data: { w2_x: "1" } }, { file: "extra/en/m1-3c.json", data: { w2_x: "2" } }])).toThrow(/w2_x.*m1-3b\.json.*m1-3c\.json/);
  });
  it("fails on a clash with the legacy extra/en.json", () => {
    const d = mkdtempSync(join(tmpdir(), "mm-extra-"));
    mkdirSync(join(d, "vi"));
    writeFileSync(join(d, "vi.json"), JSON.stringify({ w2_dup: "x" }));
    writeFileSync(join(d, "vi", "m2-2.json"), JSON.stringify({ w2_dup: "y" }));
    expect(() => loadExtra(d, "vi")).toThrow(/vi\.json.*m2-2\.json/);
  });
});
