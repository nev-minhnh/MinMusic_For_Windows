import { describe, it, expect } from "vitest";
import { buildSprite } from "./host";

describe("icon sprite", () => {
  it("merges files, unwrapping a full <svg> and keeping bare <symbol> files", () => {
    const html = buildSprite({ "m0.svg": '<svg xmlns="x"><symbol id="i-a"/></svg>', "m1-3a.svg": '<symbol id="i-b"/>' });
    expect(html).toContain('id="i-a"');
    expect(html).toContain('id="i-b"');
    expect(html.match(/<svg/g)).toHaveLength(1);
  });
  it("fails on a duplicate id, naming both files", () => {
    expect(() => buildSprite({ "m0.svg": '<symbol id="i-a"/>', "m2-2.svg": '<symbol id="i-a"/>' })).toThrow(/i-a.*m0\.svg.*m2-2\.svg/);
  });
});
