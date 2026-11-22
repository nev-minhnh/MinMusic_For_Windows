import { describe, expect, it } from "vitest";
import { IDLE, bind, fraction, reduce, started } from "./job";

describe("import job reducer", () => {
  it("runs from started to done and keeps the failed list and album", () => {
    let s = bind(started(10), "j1");
    s = reduce(s, { jobId: "j1", done: 4, total: 10, failed: 1 });
    expect(s).toMatchObject({ phase: "running", done: 4, failed: 1 });
    expect(fraction(s)).toBe(0.4);
    s = reduce(s, { jobId: "j1", done: 10, total: 10, failed: 2, failedTracks: ["a", "b"], albumId: "lp:9" });
    expect(s).toMatchObject({ phase: "done", failedTracks: ["a", "b"], albumId: "lp:9", failed: 2 });
    expect(fraction(s)).toBe(1);
  });
  it("adopts the jobId of the first event when the run reply is still in flight", () => {
    const s = reduce(started(5), { jobId: "j2", done: 2, total: 5, failed: 0 });
    expect(s).toMatchObject({ phase: "running", jobId: "j2", done: 2 });
  });
  it("ignores other jobs, stale events and events after the end", () => {
    const run = bind(started(10), "j1");
    expect(reduce(run, { jobId: "other", done: 9, total: 10, failed: 0 })).toBe(run);
    const mid = reduce(run, { jobId: "j1", done: 6, total: 10, failed: 0 });
    expect(reduce(mid, { jobId: "j1", done: 3, total: 10, failed: 0 })).toBe(mid);
    const end = reduce(mid, { jobId: "j1", done: 10, total: 10, failed: 0 });
    expect(reduce(end, { jobId: "j1", done: 11, total: 10, failed: 0 })).toBe(end);
    expect(reduce(IDLE, { jobId: "j1", done: 1, total: 1, failed: 0 })).toBe(IDLE);
  });
  it("clamps done to total and failed to done; an unknown total keeps the one from the run", () => {
    expect(reduce(started(8), { jobId: "j", done: 3, total: 0, failed: 9 })).toMatchObject({ done: 3, total: 8, failed: 3 });
    expect(reduce(started(4), { jobId: "j", done: 99, total: 4, failed: 0 }).phase).toBe("done");
    expect(fraction(IDLE)).toBe(0);
  });
});
