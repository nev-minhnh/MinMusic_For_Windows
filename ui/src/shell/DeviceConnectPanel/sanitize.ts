// The QR comes from the core as an SVG string (`dc.state.qrSvg`). It is rendered through innerHTML, so it is rebuilt from a whitelist first:
// only the shapes a QR needs, only presentation attributes, no scripts, no event handlers, no external references, no styles.
const TAGS = new Set(["svg", "g", "rect", "path", "circle", "polygon", "polyline", "line", "title", "desc"]);
const ATTRS = new Set([
  "xmlns", "viewBox", "width", "height", "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "d", "points", "transform",
  "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "shape-rendering", "preserveAspectRatio", "role", "aria-label",
]);
const SAFE_VALUE = /^[^<>]*$/;
// fill="url(#x)" would reference other nodes; only plain colours are allowed
const BAD_VALUE = /url\s*\(|javascript:|data:|expression\s*\(|@import/i;

function clean(src: Element, doc: Document): Element | null {
  const name = src.localName;
  if (!TAGS.has(name)) return null;
  const out = doc.createElementNS("http://www.w3.org/2000/svg", name);
  for (const a of Array.from(src.attributes)) {
    const n = a.name;
    if (!ATTRS.has(n) || /^on/i.test(n)) continue;
    if (!SAFE_VALUE.test(a.value) || BAD_VALUE.test(a.value)) continue;
    out.setAttribute(n, a.value);
  }
  for (const ch of Array.from(src.childNodes)) {
    if (ch.nodeType === 1) {
      const c = clean(ch as Element, doc);
      if (c) out.appendChild(c);
    } else if (ch.nodeType === 3 && (name === "title" || name === "desc")) out.appendChild(doc.createTextNode(ch.textContent ?? ""));
  }
  return out;
}

/** Returns a safe `<svg>` string, or "" when the input is not a parseable SVG. */
export function sanitizeSvg(svg: string): string {
  if (!svg || svg.length > 400_000 || typeof DOMParser === "undefined") return "";
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  } catch {
    return "";
  }
  const root = doc.documentElement;
  if (!root || root.localName !== "svg" || doc.getElementsByTagName("parsererror").length) return "";
  const out = clean(root, doc);
  return out ? new XMLSerializer().serializeToString(out) : "";
}
