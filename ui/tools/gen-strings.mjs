// Generates ui/src/i18n/<locale>.json from the Android strings.xml plus extra/<locale>.json.
// Only keys referenced as t("key") / plural("key") in ui/src are emitted (tree-shaken).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\@/g, "@")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/%(\d+)\$[sd]/g, (_, n) => `{${Number(n) - 1}}`)
    .replace(/%[sd]/g, "{0}");
}

export function parseStringsXml(xml) {
  const out = {};
  for (const m of xml.matchAll(/<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) out[m[1]] = decodeXml(m[2]);
  for (const m of xml.matchAll(/<plurals\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/plurals>/g)) {
    const forms = {};
    for (const it of m[2].matchAll(/<item\s+quantity="([^"]+)"[^>]*>([\s\S]*?)<\/item>/g)) forms[it[1]] = decodeXml(it[2]);
    out[m[1]] = forms;
  }
  return out;
}

export function scanKeys(dir) {
  const keys = new Set();
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) {
        if (f === "i18n") continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/\b(?:t|plural)\(\s*["']([\w.]+)["']/g)) keys.add(m[1]);
        // `i18n: "key"` (toast({i18n}), anything that hands a key to t() later)
        for (const m of src.matchAll(/\bi18n:\s*["']([\w.]+)["']/g)) keys.add(m[1]);
      }
    }
  };
  walk(dir);
  return keys;
}

/** Merges extra string files [{file, data}]. The same key in two files is a build error naming both files. */
export function mergeExtra(sources) {
  const out = {};
  const from = {};
  for (const { file, data } of sources) {
    for (const [k, v] of Object.entries(data)) {
      if (k in out) throw new Error(`gen-strings: duplicate key "${k}" in ${from[k]} and ${file}`);
      out[k] = v;
      from[k] = file;
    }
  }
  return out;
}

/** extra/<locale>.json plus every extra/<locale>/*.json (one file per WP). */
export function loadExtra(extraDir, locale) {
  const sources = [];
  const single = join(extraDir, locale + ".json");
  if (existsSync(single)) sources.push({ file: single, data: JSON.parse(readFileSync(single, "utf8")) });
  const dir = join(extraDir, locale);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      sources.push({ file: join(dir, f), data: JSON.parse(readFileSync(join(dir, f), "utf8")) });
    }
  }
  return mergeExtra(sources);
}

export function build(keys, base, loc, extra) {
  const out = {};
  for (const k of [...keys].sort()) {
    const v = extra[k] ?? loc[k] ?? base[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const root = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const ui = resolve(root, "..");
  const candidates = [
    process.env.MINMUSIC_STRINGS_ROOT,
    resolve(ui, "../core/MinMusic/shared/src/commonMain/composeResources"),
    "D:/Coding_Project/MinMusic/shared/src/commonMain/composeResources",
  ].filter(Boolean);
  const res = candidates.find((c) => existsSync(join(c, "values/strings.xml")));
  const read = (sub) => (res && existsSync(join(res, sub, "strings.xml")) ? parseStringsXml(readFileSync(join(res, sub, "strings.xml"), "utf8")) : {});
  if (!res) console.warn("gen-strings: core strings.xml not found, using extra/*.json only");
  const keys = scanKeys(join(ui, "src"));
  const base = read("values");
  const extraDir = join(ui, "src/i18n/extra");
  let extraEn, extraVi;
  try {
    extraEn = loadExtra(extraDir, "en");
    extraVi = loadExtra(extraDir, "vi");
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(1);
  }
  const extra = (l) => (l === "en" ? extraEn : extraVi);
  mkdirSync(join(ui, "src/i18n"), { recursive: true });
  let missing = 0;
  for (const [l, dir] of [["en", "values"], ["vi", "values-vi"]]) {
    const out = build(keys, { ...base, ...extra("en") }, l === "en" ? base : read(dir), extra(l));
    for (const k of keys) if (!(k in out)) { console.warn(`gen-strings: missing key ${k} (${l})`); missing++; }
    writeFileSync(join(ui, `src/i18n/${l}.json`), JSON.stringify(out, null, 1) + "\n");
  }
  console.log(`gen-strings: ${keys.size} keys, ${missing} missing`);
}
