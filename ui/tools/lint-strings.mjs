// Fails when a TSX file has JSX text nodes that contain letters (hard-coded user-visible text).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
let bad = 0;
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".tsx")) {
      const txt = readFileSync(p, "utf8");
      // text between ">" and "<" that is not inside braces and contains a letter
      for (const m of txt.matchAll(/>([^<>{}=]*\p{L}[^<>{}]*)</gu)) {
        const s = m[1].trim();
        if (!s || /^[\s ·|/•–-]+$/.test(s) || s.includes("=>") || /^\s*[\w.]+\s*$/.test(s) && false) continue;
        // ignore generics / arrow params that look like text
        if (/[;()=]/.test(s) || /^[\w.$]+\.[\w.$]+$/.test(s)) continue;
        const line = txt.slice(0, m.index).split("\n").length;
        console.error(`${p}:${line}: JSX text "${s}"`);
        bad++;
      }
    }
  }
};
walk(src);
if (bad) {
  console.error(`lint-strings: ${bad} hard-coded JSX text node(s)`);
  process.exit(1);
}
console.log("lint-strings: ok");
