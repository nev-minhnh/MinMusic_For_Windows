import { describe, expect, it } from "vitest";
import { bandDb, coeffs, curveDb, dbOfY, hzOfX, logGrid, xOfHz, yOfDb, type Band } from "./biquad";
import { formatApo, parseApo, responseDb } from "../../../../mock-core/src/handlers/eq.ts";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const db = (b: Band, hz: number) => bandDb(coeffs(b), hz);

describe("biquad magnitude (RBJ, 48 kHz)", () => {
  it("peak: +6 dB at the centre, ~0 far away", () => {
    const b: Band = { type: "PK", freq: 1000, gain: 6, q: 1.41 };
    expect(db(b, 1000)).toBeCloseTo(6, 2);
    expect(Math.abs(db(b, 20))).toBeLessThan(0.1);
    expect(Math.abs(db(b, 20000))).toBeLessThan(0.5);
  });
  it("shelves reach their gain on the far side", () => {
    expect(db({ type: "LSC", freq: 100, gain: 8, q: 0.71 }, 20)).toBeCloseTo(8, 0);
    expect(db({ type: "HSC", freq: 8000, gain: -6, q: 0.71 }, 20000)).toBeLessThan(-5);
  });
  it("low-pass, high-pass, band-pass and notch", () => {
    expect(db({ type: "LPQ", freq: 1000, gain: 0, q: 0.71 }, 1000)).toBeCloseTo(-3.01, 1);
    expect(db({ type: "HPQ", freq: 1000, gain: 0, q: 0.71 }, 1000)).toBeCloseTo(-3.01, 1);
    expect(db({ type: "BP", freq: 1000, gain: 0, q: 2 }, 1000)).toBeCloseTo(0, 2);
    expect(db({ type: "NO", freq: 1000, gain: 0, q: 5 }, 1000)).toBeLessThan(-40);
  });
  it("gain is ignored for types without gain", () => {
    expect(db({ type: "LPQ", freq: 1000, gain: 12, q: 0.71 }, 1000)).toBeCloseTo(-3.01, 1);
  });
  it("matches the mock core's independent complex evaluation within 0.1 dB (all types, 256 points)", () => {
    const bands: Band[] = [
      { type: "LSC", freq: 90, gain: 5.5, q: 0.7 }, { type: "PK", freq: 250, gain: -3, q: 1.2 }, { type: "PK", freq: 1000, gain: 4, q: 3 },
      { type: "PK", freq: 4200, gain: -6, q: 8 }, { type: "HSC", freq: 9000, gain: 3.5, q: 0.7 }, { type: "LPQ", freq: 17000, gain: 0, q: 0.9 },
      { type: "HPQ", freq: 25, gain: 0, q: 0.7 }, { type: "BP", freq: 700, gain: 0, q: 4 }, { type: "NO", freq: 3000, gain: 0, q: 6 },
    ];
    for (const set of [bands, bands.slice(0, 5), [{ type: "PK", freq: 19000, gain: 12, q: 0.5 } as Band]]) {
      const ref = responseDb(set, 256);
      const mine = curveDb(set, 256);
      let worst = 0;
      for (let i = 0; i < 256; i++) {
        expect(mine.hz[i]).toBeCloseTo(ref.hz[i]!, 6);
        worst = Math.max(worst, Math.abs(mine.db[i]! - ref.db[i]!));
      }
      expect(worst).toBeLessThan(0.1);
    }
  });
  it("log grid and plot mapping round-trip", () => {
    const g = logGrid(256);
    expect(g[0]).toBeCloseTo(20);
    expect(g[255]).toBeCloseTo(20000);
    expect(hzOfX(xOfHz(1234, 40, 800), 40, 800)).toBeCloseTo(1234, 3);
    expect(dbOfY(yOfDb(-7.5, 12, 250, 18), 12, 250, 18)).toBeCloseTo(-7.5, 6);
    expect(xOfHz(20, 40, 800)).toBeCloseTo(40);
    expect(xOfHz(20000, 40, 800)).toBeCloseTo(840);
  });
});

describe("APO / AutoEq parser", () => {
  const fixture = readFileSync([resolve(process.cwd(), "../tests/fixtures/eq/sample-apo.txt"), resolve(process.cwd(), "tests/fixtures/eq/sample-apo.txt")].find((p) => existsSync(p))!, "utf8");
  it("parses the fixture: preamp, ON filters only, types and values", () => {
    const r = parseApo(fixture);
    expect(r.preampDb).toBe(-5.8);
    expect(r.bands).toHaveLength(5);
    expect(r.bands[0]).toEqual({ type: "LSC", freq: 105, gain: 6.5, q: 0.7 });
    expect(r.bands.map((b) => b.type)).toEqual(["LSC", "PK", "PK", "PK", "HSC"]);
  });
  it("round-trips format -> parse", () => {
    const a = parseApo(fixture);
    const b = parseApo(formatApo(a.preampDb, a.bands));
    expect(b).toEqual(a);
  });
  it("accepts CRLF, BOM, LS/HS/LP shorthands and Q-less filters, rejects empty files", () => {
    const r = parseApo("﻿Preamp: -2 dB\r\nFilter 1: ON LS Fc 100 Hz Gain 3 dB\r\nFilter 2: ON HP Fc 30 Hz\r\n");
    expect(r.bands[0]).toMatchObject({ type: "LSC", gain: 3 });
    expect(r.bands[1]).toMatchObject({ type: "HPQ" });
    expect(() => parseApo("nothing here")).toThrow();
  });
  it("caps at 32 bands", () => {
    const t = Array.from({ length: 40 }, (_, i) => `Filter ${i + 1}: ON PK Fc ${100 + i * 10} Hz Gain 1 dB Q 1`).join("\n");
    expect(parseApo(t).bands).toHaveLength(32);
  });
});
