import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ROWS, buildRows, createSuggester, escStep, historyRows, type SuggestResult } from "./suggest";
import { handleEsc, pushEsc } from "../../lib/esc";

const res = (q: string): SuggestResult => ({ queries: [q], items: [] });
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { p, resolve, reject };
};

describe("createSuggester", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces: only the last of several keystrokes inside 120 ms calls the core", async () => {
    const call = vi.fn(async (q: string) => res(q));
    const out: string[] = [];
    const s = createSuggester({ call, onResult: (q) => out.push(q) });
    s.input("s");
    vi.advanceTimersByTime(100);
    s.input("so");
    vi.advanceTimersByTime(100);
    s.input("son");
    vi.advanceTimersByTime(119);
    expect(call).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await vi.runAllTimersAsync();
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("son");
    expect(out).toEqual(["son"]);
  });

  it("a slow answer that a newer keystroke superseded is dropped", async () => {
    const d1 = deferred<SuggestResult>();
    const calls: string[] = [];
    const out: string[] = [];
    const s = createSuggester({
      call: (q) => (calls.push(q), q === "a" ? d1.p : Promise.resolve(res(q))),
      onResult: (q) => out.push(q),
    });
    s.input("a");
    await vi.advanceTimersByTimeAsync(120);
    s.input("ab");
    await vi.advanceTimersByTimeAsync(120);
    d1.resolve(res("a")); // late
    await vi.runAllTimersAsync();
    expect(calls).toEqual(["a", "ab"]);
    expect(out).toEqual(["ab"]);
  });

  it("cancelled errors are silent and cancel() drops a pending call and an answer in flight", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deferred<SuggestResult>();
    const out: string[] = [];
    const s = createSuggester({ call: () => d.p, onResult: (q) => out.push(q), isCancelled: (e) => e === "cancelled" });
    s.input("x");
    await vi.advanceTimersByTimeAsync(120);
    d.reject("cancelled");
    await vi.runAllTimersAsync();
    expect(warn).not.toHaveBeenCalled();
    const d2 = deferred<SuggestResult>();
    const s2 = createSuggester({ call: () => d2.p, onResult: (q) => out.push(q) });
    s2.input("y");
    await vi.advanceTimersByTimeAsync(120);
    s2.cancel();
    d2.resolve(res("y"));
    await vi.runAllTimersAsync();
    const s3 = createSuggester({ call: async (q) => res(q), onResult: (q) => out.push(q) });
    s3.input("z");
    s3.cancel();
    await vi.runAllTimersAsync();
    expect(out).toEqual([]);
    warn.mockRestore();
  });
});

describe("rows and Esc", () => {
  it("at most 8 rows, queries first", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ t: "artist", id: String(i), name: `a${i}`, source: "yt" }) as never);
    const rows = buildRows({ queries: ["q1", "q2", "q3"], items });
    expect(rows).toHaveLength(MAX_ROWS);
    expect(rows.slice(0, 3).map((r) => r.kind)).toEqual(["query", "query", "query"]);
    expect(historyRows(Array.from({ length: 20 }, (_, i) => `h${i}`))).toHaveLength(MAX_ROWS);
  });

  it("Esc in the field: clear the text, then blur; the next Esc is not the field's (global back)", () => {
    expect(escStep("sơn tùng")).toBe("clear");
    expect(escStep("")).toBe("blur");
  });

  it("Esc order: a popover layer on the Esc stack is peeled before the field steps (stack pops last-in first)", () => {
    const order: string[] = [];
    const off1 = pushEsc(() => order.push("menu"));
    const off2 = pushEsc(() => order.push("popover"));
    expect(handleEsc()).toBe(true);
    expect(handleEsc()).toBe(true);
    expect(order).toEqual(["popover", "menu"]);
    expect(handleEsc()).toBe(false); // nothing left: the global handler goes back
    off1();
    off2();
  });
});
