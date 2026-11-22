// Fails the build when two icon files define the same symbol id (src/icons/*.svg, one file per WP).
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/icons");
const seen = new Map();
let bad = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith(".svg")).sort()) {
  for (const m of readFileSync(join(dir, f), "utf8").matchAll(/<(?:symbol|linearGradient|radialGradient)\b[^>]*\bid="([^"]+)"/g)) {
    if (seen.has(m[1])) {
      console.error(`check-icons: duplicate id "${m[1]}" in ${seen.get(m[1])} and ${f}`);
      bad++;
    } else seen.set(m[1], f);
  }
}
if (bad) process.exit(1);
console.log(`check-icons: ${seen.size} ids ok`);
