import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SettingEntry } from "@minmusic/protocol";
import { layout } from "./layout";
import { coverage, fold, filterRows, highlight, matchRange } from "./search";

const schema = (JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../mock-core/fixtures/settings/schema.json"), "utf8")) as { entries: SettingEntry[] }).entries;
const byKey = new Map(schema.map((e) => [e.key, e]));

describe("settings layout coverage", () => {
  const c = coverage(schema, layout);
  it("every desktop schema key is laid out exactly once or hidden with a reason (fails on an unknown key)", () => {
    expect(c.unknown, `unclassified keys: ${c.unknown.join(", ")}`).toEqual([]);
  });
  it("coverage reports an unknown key", () => {
    const extra: SettingEntry = { key: "brandNewKey", type: "bool", default: false, platform: "all" };
    expect(coverage([...schema, extra], layout).unknown).toEqual(["brandNewKey"]);
    expect(coverage([...schema, { ...extra, platform: "android" }], layout).unknown).toEqual([]);
  });
  it("no key is laid out twice, laid out and hidden, unknown to the schema, or Android-only", () => {
    expect(c.twice).toEqual([]);
    expect(c.laidAndHidden).toEqual([]);
    expect(c.notInSchema).toEqual([]);
    expect(c.androidLaid).toEqual([]);
  });
  it("the key groups named by the brief are present", () => {
    const laid = new Set(Object.values(layout).flatMap((gs) => gs.flatMap((g) => g.rows.map((r) => r.key))));
    for (const k of ["desktopFloatingPlayerBar", "minimizeToTrayOnClose", "desktopMiniPlayerWindow", "desktopMiniPlayerOnMinimize", "desktopTaskbarButtons", "desktopTrayToggleOnClick", "desktopSidebarDocked", "themeMode", "appLanguage", "lyricsAiApiKey", "lyricsRomanizationEnabled", "hideExplicit", "pauseListenHistory", "seekDurationSeconds"]) {
      expect(laid.has(k), k).toBe(true);
    }
  });
  it("a row dependency is a bool key, secrets use the secret kind, forced kinds fit the entry type", () => {
    for (const gs of Object.values(layout)) for (const g of gs) for (const r of g.rows) {
      const e = byKey.get(r.key)!;
      if (r.dep) expect(byKey.get(r.dep)?.type, `${r.key} dep`).toBe("bool");
      if (e.type === "secret") expect(r.kind, r.key).toBe("secret");
      if (r.kind === "seg" || r.kind === "select") expect(e.type, r.key).toBe("enum");
      if (r.kind === "slider") expect(e.min !== undefined && e.max !== undefined, `${r.key} needs min/max`).toBe(true);
      if (r.kind === "stepper") expect(["int", "float"], r.key).toContain(e.type);
    }
  });
  it("themeMode order lists exactly the schema values", () => {
    const row = layout.Appearance.flatMap((g) => g.rows).find((r) => r.key === "themeMode")!;
    expect([...row.order!].sort()).toEqual([...byKey.get("themeMode")!.enumValues!].sort());
  });
});

describe("settings search", () => {
  it("folds case and Vietnamese diacritics char for char", () => {
    expect(fold("Đổi Tên Ảnh Bìa")).toBe("doi ten anh bia");
    expect(fold("Đổi").length).toBe(3);
  });
  it("matches a translated label and reports the range", () => {
    expect(matchRange("Hiện nút video", "NUT")).toEqual([5, 8]);
    expect(matchRange("Chủ đề", "chu de")).toEqual([0, 6]);
    expect(matchRange("Chủ đề", "zzz")).toBeNull();
    expect(matchRange("abc", "  ")).toBeNull();
  });
  it("highlight splits the label around the hit", () => {
    expect(highlight("Hiện nút video", "nút")).toEqual({ before: "Hiện ", hit: "nút", after: " video" });
    expect(highlight("Hide explicit songs", "xyz")).toBeNull();
  });
  it("filterRows searches across pages, honours visibility, and is empty for an empty query", () => {
    expect(filterRows(layout, "")).toEqual([]);
    const hits = filterRows(layout, "show");
    expect(new Set(hits.map((h) => h.page)).size).toBeGreaterThan(1);
    expect(filterRows(layout, "show", () => false)).toEqual([]);
    const one = filterRows(layout, "default sleep timer", (k) => k === "sleepTimerDefaultMinutes");
    expect(one.map((h) => h.row.key)).toEqual(["sleepTimerDefaultMinutes"]);
  });
});
