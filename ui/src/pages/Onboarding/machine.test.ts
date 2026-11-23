import { describe, expect, it } from "vitest";
import { STEPS, initial, isFirstRun, reduce, type Event, type State } from "./machine";

const run = (evs: Event[], s: State = initial()) => evs.reduce(reduce, s);

describe("onboarding machine", () => {
  it("walks the steps in order and finishes after the last", () => {
    let s = initial();
    const seen: string[] = [s.step];
    for (let i = 0; i < STEPS.length - 1; i++) {
      s = reduce(s, { type: "next" });
      seen.push(s.step);
    }
    expect(seen).toEqual([...STEPS]);
    expect(s.finished).toBe(false);
    expect(reduce(s, { type: "next" }).finished).toBe(true);
  });
  it("skip behaves like next, back stops at the first step", () => {
    expect(run([{ type: "skip" }]).step).toBe("sources");
    expect(run([{ type: "back" }]).step).toBe("welcome");
    expect(run([{ type: "next" }, { type: "next" }, { type: "back" }]).step).toBe("sources");
  });
  it("finish ends the flow from anywhere and a finished flow is frozen", () => {
    const f = run([{ type: "next" }, { type: "finish" }]);
    expect(f.finished).toBe(true);
    expect(run([{ type: "back" }, { type: "goto", step: "import" }], f)).toBe(f);
  });
  it("goto jumps to a step", () => {
    expect(run([{ type: "goto", step: "youtube" }]).step).toBe("youtube");
  });
});

describe("first run detection", () => {
  it("reads {completed} and {firstRun}", () => {
    expect(isFirstRun({ completed: false })).toBe(true);
    expect(isFirstRun({ completed: true })).toBe(false);
    expect(isFirstRun({ firstRun: true })).toBe(true);
    expect(isFirstRun({ firstRun: false, completed: false })).toBe(false);
    expect(isFirstRun(undefined)).toBe(false);
    expect(isFirstRun({})).toBe(false);
  });
});
