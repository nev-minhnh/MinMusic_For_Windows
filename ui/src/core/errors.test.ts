import { describe, expect, it } from "vitest";
import { RpcError, TIMEOUT_DEFAULT_MS, TIMEOUT_LONG_MS, timeoutFor } from "@minmusic/protocol";
import { canRetry, isCancelled, shouldToast } from "./errors.ts";

const err = (code: ConstructorParameters<typeof RpcError>[0]["code"], retryable = false) => new RpcError({ code, msg: "x", retryable });

describe("client timeouts (api.md 1.2)", () => {
  it("search.* and *.page use 20 s, shell.webLogin none, everything else 15 s", () => {
    expect(timeoutFor("search.suggest")).toBe(TIMEOUT_LONG_MS);
    expect(timeoutFor("search.run")).toBe(20_000);
    expect(timeoutFor("search.history.list")).toBe(20_000);
    expect(timeoutFor("browse.page")).toBe(20_000);
    expect(timeoutFor("shell.webLogin")).toBeNull();
    expect(timeoutFor("library.window")).toBe(TIMEOUT_DEFAULT_MS);
    expect(timeoutFor("player.play")).toBe(15_000);
  });
});

describe("error surfacing", () => {
  it("cancelled never triggers a toast", () => {
    expect(isCancelled(err("cancelled"))).toBe(true);
    expect(shouldToast(err("cancelled"))).toBe(false);
  });
  it("other errors toast; only retryable ones offer a retry", () => {
    expect(shouldToast(err("network", true))).toBe(true);
    expect(shouldToast(new Error("boom"))).toBe(true);
    expect(canRetry(err("network", true))).toBe(true);
    expect(canRetry(err("not_found"))).toBe(false);
    expect(canRetry(new Error("x"))).toBe(false);
  });
});
