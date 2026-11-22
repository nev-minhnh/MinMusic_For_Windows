/** Merges the icon files (one per WP, `<symbol>` elements only; m0.svg still carries its <svg> wrapper) into one hidden sprite. */
const SVG_WRAP = /^\s*<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/;

export function buildSprite(files: Record<string, string>): string {
  const seen = new Map<string, string>();
  const parts: string[] = [];
  for (const [file, raw] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const inner = SVG_WRAP.exec(raw)?.[1] ?? raw;
    for (const m of inner.matchAll(/\bid="([^"]+)"/g)) {
      const prev = seen.get(m[1]);
      if (prev) throw new Error(`icons: duplicate id "${m[1]}" in ${prev} and ${file}`);
      seen.set(m[1], file);
    }
    parts.push(inner);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true"><style>.f{fill:currentColor;stroke:none}</style>${parts.join("")}</svg>`;
}

/** Called once from main.tsx. */
export function injectSprite(): void {
  const files = import.meta.glob("./*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  document.body.insertAdjacentHTML("afterbegin", buildSprite(files));
}
