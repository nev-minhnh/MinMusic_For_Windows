import { describe, expect, it } from "vitest";
import { PlaybackClock, formatTime } from "./clock.ts";

function mk() {
  let t = 1000;
  const clock = new PlaybackClock(() => t);
  return { clock, advance: (ms: number) => { t += ms; }, now: () => t };
}

describe("PlaybackClock", () => {
  it("interpolates while playing", () => {
    const { clock, advance } = mk();
    clock.update({ posMs: 10_000, durMs: 200_000, playing: true, rate: 1 });
    advance(2500);
    expect(clock.position()).toBe(12_500);
  });
  it("is frozen while paused", () => {
    const { clock, advance } = mk();
    clock.update({ posMs: 10_000, durMs: 200_000, playing: false });
    advance(5000);
    expect(clock.position()).toBe(10_000);
  });
  it("honours the rate", () => {
    const { clock, advance } = mk();
    clock.update({ posMs: 0, durMs: 100_000, playing: true, rate: 1.5 });
    advance(2000);
    expect(clock.position()).toBe(3000);
  });
  it("clamps to the duration and to zero", () => {
    const { clock, advance } = mk();
    clock.update({ posMs: 99_000, durMs: 100_000, playing: true });
    advance(60_000);
    expect(clock.position()).toBe(100_000);
    clock.update({ posMs: -50, durMs: 100_000, playing: false });
    expect(clock.position()).toBe(0);
  });
  it("a new position event rebases the clock (drift correction)", () => {
    const { clock, advance } = mk();
    clock.update({ posMs: 0, durMs: 200_000, playing: true });
    advance(1100); // local says 1100
    clock.update({ posMs: 1000, durMs: 200_000, playing: true }); // core says 1000
    expect(clock.position()).toBe(1000);
    advance(500);
    expect(clock.position()).toBe(1500);
  });
  it("patch keeps the current position when the state changes", () => {
    const { clock, advance } = mk();
    clock.update({ posMs: 5000, durMs: 200_000, playing: true });
    advance(1000);
    clock.patch({ playing: false });
    expect(clock.position()).toBe(6000);
    advance(3000);
    expect(clock.position()).toBe(6000);
    clock.patch({ playing: true });
    advance(1000);
    expect(clock.position()).toBe(7000);
  });
  it("msToNextSecond aligns the label timer to whole seconds", () => {
    const { clock, advance } = mk();
    clock.update({ posMs: 10_250, durMs: 200_000, playing: true });
    expect(clock.msToNextSecond()).toBe(750);
    advance(750);
    expect(clock.position()).toBe(11_000);
    expect(clock.msToNextSecond()).toBe(1000);
    clock.update({ posMs: 10_500, durMs: 200_000, playing: true, rate: 2 });
    expect(clock.msToNextSecond()).toBe(250);
    clock.patch({ playing: false });
    expect(clock.msToNextSecond()).toBeNull();
  });
  it("msUntil schedules lyric lines", () => {
    const { clock } = mk();
    clock.update({ posMs: 1000, durMs: 100_000, playing: true, rate: 2 });
    expect(clock.msUntil(5000)).toBe(2000);
    expect(clock.msUntil(500)).toBe(0);
    expect(clock.msUntil(200_000)).toBeNull();
  });
  it("fraction and remainingMs feed the CSS progress animation", () => {
    const { clock } = mk();
    clock.update({ posMs: 25_000, durMs: 100_000, playing: true, rate: 1 });
    expect(clock.fraction()).toBe(0.25);
    expect(clock.remainingMs()).toBe(75_000);
  });
});

describe("formatTime", () => {
  it.each([[0, "0:00"], [999, "0:00"], [61_000, "1:01"], [3_599_000, "59:59"], [3_600_000, "1:00:00"], [-5, "0:00"]])(
    "%s -> %s", (ms, s) => expect(formatTime(ms as number)).toBe(s));
});
