import { describe, expect, it } from "vitest";
import { defaultBackupName } from "./native";
import { fmtBytes, restoreGate } from "./logic";

describe("restore confirm gating", () => {
  it("allows a valid desktop backup", () => {
    expect(restoreGate({ ok: true, platform: "desktop", dbVersion: 47, createdAt: 1 })).toEqual({ allow: true });
    expect(restoreGate({ ok: true, platform: "desktop-v1", dbVersion: 40 })).toEqual({ allow: true });
  });
  it("refuses a file the core could not inspect", () => {
    expect(restoreGate({ ok: false, platform: "unknown", dbVersion: 0, error: "x" })).toEqual({ allow: false, reason: "invalid" });
  });
  it("sends an Android backup to the import path instead", () => {
    expect(restoreGate({ ok: true, platform: "Android", dbVersion: 47 })).toEqual({ allow: false, reason: "android" });
  });
});

describe("format", () => {
  it("bytes", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(1536)).toBe("1.5 KB");
    expect(fmtBytes(1048576)).toBe("1.0 MB");
    expect(fmtBytes(-1)).toBe("-");
  });
  it("default backup name is dated", () => {
    expect(defaultBackupName(new Date(2026, 10, 3))).toBe("MinMusic-backup-2026-11-03.zip");
  });
});
