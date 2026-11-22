#!/usr/bin/env node
// Writes <file>.sha256 ("<hex>  <name>", sha256sum format) next to each given file.
//   node scripts/ci/hash-assets.mjs <file>...
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
const files = process.argv.slice(2);
if (!files.length) { console.error("usage: hash-assets.mjs <file>..."); process.exit(2); }
for (const f of files) {
  const hex = createHash("sha256").update(readFileSync(f)).digest("hex");
  writeFileSync(`${f}.sha256`, `${hex}  ${basename(f)}\n`);
  console.log(`${hex}  ${basename(f)}`);
}
