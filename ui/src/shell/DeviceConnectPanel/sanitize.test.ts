// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./sanitize";

const QR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges"><rect width="29" height="29" fill="#fff"/><path d="M4 4h1v1h-1z" fill="#000"/></svg>`;

describe("sanitizeSvg", () => {
  it("keeps a plain QR svg intact (shapes, viewBox, paint)", () => {
    const out = sanitizeSvg(QR);
    expect(out).toContain("<svg");
    expect(out).toContain('viewBox="0 0 29 29"');
    expect(out).toContain('d="M4 4h1v1h-1z"');
    expect(out).toContain('fill="#000"');
  });
  it("drops script, foreignObject, style and use elements", () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject><div>x</div></foreignObject><style>*{}</style><use href="#a"/><path d="M0 0h1"/></svg>`);
    expect(out).not.toMatch(/script|foreignObject|style|<use|alert/i);
    expect(out).toContain("<path");
  });
  it("strips event handler attributes and javascript/url() values", () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect onclick="x()" width="1" height="1" fill="url(#p)"/><path d="M0 0" fill="javascript:x" stroke="#000" onmouseover="y()"/></svg>`);
    expect(out).not.toMatch(/onload|onclick|onmouseover|url\(|javascript/i);
    expect(out).toContain('stroke="#000"');
  });
  it("drops href attributes and unknown attributes", () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><path d="M0 0" xlink:href="x" data-x="1" style="x:y"/></a></svg>`);
    expect(out).not.toMatch(/href|data-x|style|<a/i);
  });
  it("returns an empty string for non-svg or broken input", () => {
    expect(sanitizeSvg("")).toBe("");
    expect(sanitizeSvg("<div>hi</div>")).toBe("");
    expect(sanitizeSvg("<svg><path")).toBe("");
    expect(sanitizeSvg("x".repeat(500_000))).toBe("");
  });
});
