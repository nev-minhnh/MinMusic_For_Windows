import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToastController, TOAST_MS, TOAST_OUT_MS, MAX_QUEUE } from "./controller";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("toast controller", () => {
  it("shows one toast for 4 s, then fades out", () => {
    const c = new ToastController();
    c.push({ text: "a" });
    expect(c.current?.text).toBe("a");
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(c.leaving).toBe(false);
    vi.advanceTimersByTime(1);
    expect(c.leaving).toBe(true);
    vi.advanceTimersByTime(TOAST_OUT_MS);
    expect(c.current).toBeNull();
  });
  it("1 visible + a queue of 3: the oldest queued toast is dropped when full", () => {
    const c = new ToastController();
    for (const x of ["1", "2", "3", "4", "5"]) c.push({ text: x });
    expect(c.current?.text).toBe("1");
    expect(c.queue.map((q) => q.text)).toEqual(["3", "4", "5"]);
    expect(c.queue).toHaveLength(MAX_QUEUE);
  });
  it("shows queued toasts in order", () => {
    const c = new ToastController();
    c.push({ text: "1" });
    c.push({ text: "2" });
    vi.advanceTimersByTime(TOAST_MS + TOAST_OUT_MS);
    expect(c.current?.text).toBe("2");
  });
  it("hover pauses the countdown and resume continues with the remaining time", () => {
    const c = new ToastController();
    c.push({ text: "a" });
    vi.advanceTimersByTime(3000);
    c.pause();
    vi.advanceTimersByTime(60_000);
    expect(c.leaving).toBe(false);
    c.resume();
    vi.advanceTimersByTime(999);
    expect(c.leaving).toBe(false);
    vi.advanceTimersByTime(1);
    expect(c.leaving).toBe(true);
  });
});
