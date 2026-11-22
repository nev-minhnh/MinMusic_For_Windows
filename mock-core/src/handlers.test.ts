import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHandlers } from "./server.ts";
import { generateDataset } from "./gen.ts";

describe("handler loading", () => {
  it("loads every area and finds the M0 methods", async () => {
    const { handlers, files } = await loadHandlers();
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const m of ["sys.ping", "home.get", "library.window", "album.get", "player.play"]) expect(handlers.has(m), m).toBe(true);
  });
  it("a duplicate method throws and names both files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-handlers-"));
    writeFileSync(join(dir, "a.mjs"), "export const handlers = { 'x.y': () => 1 };");
    writeFileSync(join(dir, "b.mjs"), "export const handlers = { 'x.y': () => 2 };");
    await expect(loadHandlers(dir)).rejects.toThrow(/duplicate method x\.y in a\.mjs and b\.mjs/);
  });
  it("a duplicate topic throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-handlers-"));
    writeFileSync(join(dir, "a.mjs"), "export const topics = { t: () => 1 };");
    writeFileSync(join(dir, "b.mjs"), "export const topics = { t: () => 2 };");
    await expect(loadHandlers(dir)).rejects.toThrow(/duplicate topic t/);
  });
});

describe("dataset", () => {
  it("is deterministic and has the agreed sizes", () => {
    const a = generateDataset();
    const b = generateDataset();
    expect(JSON.stringify(a.songs.slice(0, 50))).toBe(JSON.stringify(b.songs.slice(0, 50)));
    expect(a.songs.length).toBe(5000);
    expect(a.albums.length).toBe(40);
    expect(a.userAlbums.length).toBe(10);
    expect(a.history.length).toBe(2000);
    expect(new Set(a.songs.map((s) => s.id)).size).toBe(5000);
  });
});
