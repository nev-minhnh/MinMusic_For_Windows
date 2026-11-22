#!/usr/bin/env node
// Release gate: the git tag must be v<version> where <version> is src-tauri/tauri.conf.json "version"
// (and package.json "version"), and the updater pubkey must be a real key, not the placeholder.
//   node scripts/ci/check-tag.mjs <tag> [--conf <tauri.conf.json>] [--pkg <package.json>] [--no-pubkey]
//   node scripts/ci/check-tag.mjs --selftest
// With GITHUB_OUTPUT set it writes version=<v> and prerelease=<true|false>.
import { readFileSync, appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;
const PLACEHOLDER = /placeholder|todo|changeme|replace|xxxx/i;

export function check({ tag, conf, pkg, pubkey = true }) {
  const errors = [];
  if (!tag?.startsWith("v")) errors.push(`tag '${tag}' must start with 'v'`);
  const tagVersion = (tag ?? "").replace(/^v/, "");
  if (!SEMVER.test(tagVersion)) errors.push(`tag '${tag}' is not vMAJOR.MINOR.PATCH[-pre]`);
  if (conf.version !== tagVersion) errors.push(`tag ${tag} != tauri.conf.json version ${conf.version}`);
  if (pkg && pkg.version !== tagVersion) errors.push(`tag ${tag} != package.json version ${pkg.version}`);
  if (pubkey) {
    const key = conf.plugins?.updater?.pubkey;
    if (typeof key !== "string" || key.length < 40 || PLACEHOLDER.test(key)) {
      errors.push("tauri.conf.json plugins.updater.pubkey is missing or still the placeholder (see docs/release/release-process.md)");
    }
    if (conf.bundle?.createUpdaterArtifacts !== true && conf.bundle?.createUpdaterArtifacts !== "v1Compatible") {
      errors.push("tauri.conf.json bundle.createUpdaterArtifacts must be true (the .sig is required for latest.json)");
    }
  }
  return { errors, version: tagVersion, prerelease: tagVersion.includes("-") };
}

function selftest() {
  const good = { version: "2.0.0", plugins: { updater: { pubkey: "A".repeat(80) } }, bundle: { createUpdaterArtifacts: true } };
  const cases = [
    [{ tag: "v2.0.0", conf: good, pkg: { version: "2.0.0" } }, 0],
    [{ tag: "v2.0.1", conf: good }, 1],
    [{ tag: "2.0.0", conf: good }, 1],
    [{ tag: "v2.0.0", conf: { ...good, plugins: { updater: { pubkey: "PLACEHOLDER_PUBKEY_PLACEHOLDER_PUBKEY_PLACEHOLDER" } } } }, 1],
    [{ tag: "v2.0.0", conf: { version: "2.0.0", plugins: {}, bundle: {} } }, 2],
    [{ tag: "v2.0.0", conf: { version: "2.0.0" }, pubkey: false }, 0],
    [{ tag: "v2.0.0", conf: good, pkg: { version: "1.0.0" } }, 1],
  ];
  let bad = 0;
  cases.forEach(([c, n], i) => {
    const r = check(c);
    if (r.errors.length !== n) { console.error(`selftest case ${i}: expected ${n} errors, got ${r.errors.length}: ${r.errors}`); bad++; }
  });
  if (check({ tag: "v2.0.0-rc.1", conf: { ...good, version: "2.0.0-rc.1" } }).prerelease !== true) { console.error("prerelease flag"); bad++; }
  if (check({ tag: "v2.0.0", conf: good }).prerelease !== false) { console.error("stable flag"); bad++; }
  console.log(bad ? `selftest FAILED (${bad})` : `selftest ok (${cases.length + 2} checks)`);
  process.exit(bad ? 1 : 0);
}

const argv = process.argv.slice(2);
if (argv.includes("--selftest")) selftest();
else {
  const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const tag = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--")) ?? process.env.RELEASE_TAG;
  const conf = JSON.parse(readFileSync(opt("--conf", join(root, "src-tauri", "tauri.conf.json")), "utf8"));
  const pkg = JSON.parse(readFileSync(opt("--pkg", join(root, "package.json")), "utf8"));
  const r = check({ tag, conf, pkg, pubkey: !argv.includes("--no-pubkey") });
  if (r.errors.length) { for (const e of r.errors) console.error(`::error::${e}`); process.exit(1); }
  console.log(`tag ${tag} matches version ${r.version} (prerelease=${r.prerelease})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${r.version}\nprerelease=${r.prerelease}\n`);
}
