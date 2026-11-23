import { describe, expect, it } from "vitest";
import { createCoalescer } from "./eq";

/** A frame scheduler under test control. */
function frames() {
  const q: (() => void)[] = [];
  return { schedule: (cb: () => void) => { q.push(cb); }, run: () => { const f = q.splice(0); f.forEach((x) => x()); }, pending: () => q.length };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("eq.updateBand coalescer", () => {
  it("many updates inside one frame -> one call, last value wins, patches merge", async () => {
    const f = frames();
    const calls: [string, any][] = [];
    const c = createCoalescer(async (k, p) => { calls.push([k, p]); }, { schedule: f.schedule });
    for (let i = 0; i < 50; i++) c.push("b:2", { freq: 100 + i, gain: i / 10 });
    c.push("b:2", { q: 2 });
    expect(f.pending()).toBe(1);
    f.run();
    expect(calls).toEqual([["b:2", { freq: 149, gain: 4.9, q: 2 }]]);
  });
  it("a 3 s drag at 60 fps and 1 kHz pointer events -> at most one call per frame", async () => {
    const f = frames();
    let n = 0;
    const c = createCoalescer(async () => { n++; }, { schedule: f.schedule });
    const frameCount = 180;
    for (let fr = 0; fr < frameCount; fr++) {
      for (let k = 0; k < 16; k++) c.push("b:0", { freq: 100 + fr + k });
      f.run();
      for (let m = 0; m < 4; m++) await Promise.resolve(); // the call returns before the next frame
    }
    expect(n).toBeLessThanOrEqual(frameCount);
    expect(n).toBe(frameCount);
  });
  it("never two calls in flight: a slow core gets the last value once it is free", async () => {
    const f = frames();
    const calls: any[] = [];
    let release!: () => void;
    const c = createCoalescer((k, p) => { calls.push(p); return new Promise<void>((r) => (release = r)); }, { schedule: f.schedule });
    c.push("b:0", { gain: 1 });
    f.run();
    c.push("b:0", { gain: 2 });
    c.push("b:0", { gain: 3 });
    f.run();
    expect(calls).toHaveLength(1);
    expect(c.busy()).toBe(true);
    release();
    await tick();
    f.run();
    expect(calls).toEqual([{ gain: 1 }, { gain: 3 }]);
  });
  it("reports idle after the last call and survives a rejected call", async () => {
    const f = frames();
    let idle = 0;
    const c = createCoalescer(async () => { throw new Error("x"); }, { schedule: f.schedule, onIdle: () => idle++ });
    c.push("fx", { bassDb: 3 });
    f.run();
    await tick();
    expect(idle).toBe(1);
    expect(c.busy()).toBe(false);
  });
});
