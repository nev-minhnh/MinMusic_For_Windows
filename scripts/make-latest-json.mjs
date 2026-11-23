#!/usr/bin/env node
// Builds latest.json (Tauri updater static manifest) from the release assets.
//
//   node scripts/make-latest-json.mjs --version 2.0.1 --tag v2.0.1 \
//        --setup release/MinMusic-2.0.1-windows-x64-setup.exe --sig release/MinMusic-2.0.1-windows-x64-setup.exe.sig \
//        --notes-file release/notes.md --repo nev-minhnh/MinMusic_For_Windows --out release/latest.json
//        [--pub-date 2026-11-23T10:00:00Z] [--base-url http://127.0.0.1:48017]   (base-url: local e2e server only)
//   node scripts/make-latest-json.mjs --selftest        offline self test
//   node scripts/make-latest-json.mjs --check-config    fails until the real minisign public key is in tauri.conf.json (INT-W5)
//
// The interface is called by .github/workflows/release.yml (M5-3); keep them in step.
// Output (api: the updater plugin's static format; `size` is extra and read by the shell for the Updates page):
//   { version, notes, pub_date, platforms: { "windows-x86_64": { signature, url, size } } }
import { readFileSync, writeFileSync, statSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { basename, join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const DEFAULT_REPO = "nev-minhnh/MinMusic_For_Windows";
export const TARGET = "windows-x86_64";
export const ENDPOINT = `https://github.com/${DEFAULT_REPO}/releases/latest/download/latest.json`;
export const PUBKEY_PLACEHOLDER = "REPLACE_AT_INT_W5";

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** Version the Tauri CLI wrote into the signature's trusted comment (covered by the signature). */
export function signedVersion(sigText) {
  let raw = sigText.trim();
  // The .sig written by `tauri build` is the base64 of the minisign signature file.
  if (!raw.startsWith("untrusted comment:")) raw = Buffer.from(raw, "base64").toString("utf8");
  const line = raw.split(/\r?\n/).find((l) => l.startsWith("trusted comment:"));
  if (!line) return null;
  const m = /(?:^|\t|\s)version:([^\t\s]+)/.exec(line);
  return m ? m[1] : null;
}

export function buildLatest({ version, tag, setupName, sigText, notes, repo, size, pubDate, baseUrl }) {
  if (!SEMVER.test(version)) throw new Error(`version ${JSON.stringify(version)} is not semver`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`repo ${JSON.stringify(repo)} must be owner/name`);
  if (!/^[\w.+-]+$/.test(tag)) throw new Error(`tag ${JSON.stringify(tag)} has unexpected characters`);
  const signature = sigText.trim();
  if (!signature) throw new Error("empty signature");
  const sv = signedVersion(signature);
  if (sv === null) throw new Error("the signature carries no trusted-comment version (use a current Tauri CLI to sign)");
  if (sv.replace(/^v/, "") !== version) throw new Error(`signature was made for version ${sv}, not ${version}`);
  // --base-url is for the local e2e server only: loopback http, or https.
  if (baseUrl && !/^(https:\/\/|http:\/\/127\.0\.0\.1(:\d+)?(\/|$))/.test(baseUrl)) throw new Error("--base-url must be https or http://127.0.0.1[:port]");
  if (!Number.isInteger(size) || size <= 0) throw new Error("setup size must be a positive integer");
  return {
    version,
    notes: notes.trim(),
    pub_date: pubDate,
    platforms: {
      [TARGET]: {
        signature,
        url: baseUrl ? `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(setupName)}` : `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(setupName)}`,
        size,
      },
    },
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const k = a.slice(2);
    if (["selftest", "check-config"].includes(k)) out[k] = true;
    else {
      if (i + 1 >= argv.length) throw new Error(`--${k} needs a value`);
      out[k] = argv[++i];
    }
  }
  return out;
}

export function checkConfig(confPath) {
  const conf = JSON.parse(readFileSync(confPath, "utf8"));
  const u = conf?.plugins?.updater;
  const problems = [];
  if (!u) problems.push("plugins.updater is missing");
  else {
    if (JSON.stringify(u.endpoints) !== JSON.stringify([ENDPOINT])) problems.push(`endpoints must be exactly [${ENDPOINT}]`);
    if (!u.pubkey || String(u.pubkey).startsWith(PUBKEY_PLACEHOLDER)) problems.push("plugins.updater.pubkey is still the placeholder (put the real minisign public key there at INT-W5, see scripts/gen-updater-key.md)");
    if (u.dangerousInsecureTransportProtocol) problems.push("dangerousInsecureTransportProtocol must not be set in the release config");
    if (u.requireSignedVersion !== true) problems.push("requireSignedVersion must be true");
  }
  if (conf?.bundle?.createUpdaterArtifacts !== true) problems.push("bundle.createUpdaterArtifacts must be true (the release needs the .sig)");
  return problems;
}

function selftest() {
  const assert = (c, m) => {
    if (!c) throw new Error(`selftest: ${m}`);
  };
  const throws = (f, re, m) => {
    try {
      f();
    } catch (e) {
      assert(re.test(String(e.message)), `${m}: wrong error ${e.message}`);
      return;
    }
    throw new Error(`selftest: ${m}: did not throw`);
  };
  const sigFile = (v) => `untrusted comment: signature from tauri secret key\nRUQ-fake\ntrusted comment: timestamp:1\tfile:x.exe\tversion:${v}\nZmFrZQ==\n`;
  const sig = (v) => Buffer.from(sigFile(v)).toString("base64");
  const base = { version: "2.0.1", tag: "v2.0.1", setupName: "MinMusic-2.0.1-windows-x64-setup.exe", sigText: sig("2.0.1") + "\n", notes: "  Notes\n\nSecond  \n", repo: DEFAULT_REPO, size: 1234, pubDate: "2026-11-23T10:00:00Z" };
  const j = buildLatest(base);
  assert(j.version === "2.0.1" && j.notes === "Notes\n\nSecond", "version/notes");
  const p = j.platforms[TARGET];
  assert(p.url === `https://github.com/${DEFAULT_REPO}/releases/download/v2.0.1/MinMusic-2.0.1-windows-x64-setup.exe`, `url ${p.url}`);
  assert(p.signature === sig("2.0.1") && p.size === 1234, "signature/size");
  assert(signedVersion(sigFile("2.0.1")) === "2.0.1", "raw (not base64) signature");
  throws(() => buildLatest({ ...base, sigText: sig("2.0.0") }), /signature was made for version 2.0.0/, "stale signature");
  throws(() => buildLatest({ ...base, version: "2.0" }), /not semver/, "bad version");
  throws(() => buildLatest({ ...base, repo: "x" }), /owner\/name/, "bad repo");
  throws(() => buildLatest({ ...base, tag: "v1 2" }), /tag/, "bad tag");
  throws(() => buildLatest({ ...base, sigText: " " }), /empty signature/, "empty signature");
  throws(() => buildLatest({ ...base, sigText: Buffer.from("untrusted comment: a\nb\ntrusted comment: timestamp:1\nc\n").toString("base64") }), /no trusted-comment version/, "unversioned signature");
  assert(buildLatest({ ...base, version: "2.1.0-beta.1", sigText: sig("2.1.0-beta.1") }).version === "2.1.0-beta.1", "prerelease version");
  throws(() => buildLatest({ ...base, baseUrl: "http://127.0.0.1.evil.example/" }), /base-url/, "lookalike host");
  assert(buildLatest({ ...base, baseUrl: "http://127.0.0.1:48017/" }).platforms[TARGET].url === "http://127.0.0.1:48017/MinMusic-2.0.1-windows-x64-setup.exe", "base url");
  throws(() => buildLatest({ ...base, baseUrl: "http://evil.example/" }), /base-url/, "foreign base url");
  // end to end through the CLI path
  const dir = mkdtempSync(join(tmpdir(), "mm-latest-"));
  try {
    writeFileSync(join(dir, "s.exe"), Buffer.alloc(1000));
    writeFileSync(join(dir, "s.exe.sig"), sig("2.0.1"));
    writeFileSync(join(dir, "n.md"), "n");
    run(["--version", "2.0.1", "--tag", "v2.0.1", "--setup", join(dir, "s.exe"), "--sig", join(dir, "s.exe.sig"), "--notes-file", join(dir, "n.md"), "--out", join(dir, "latest.json")]);
    const out = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
    assert(out.platforms[TARGET].size === 1000 && out.platforms[TARGET].url.endsWith("/s.exe"), "cli output");
    // config check: the placeholder must fail
    const conf = join(dir, "c.json");
    const good = { plugins: { updater: { endpoints: [ENDPOINT], pubkey: "dW50cnVzdGVk", requireSignedVersion: true } }, bundle: { createUpdaterArtifacts: true } };
    writeFileSync(conf, JSON.stringify(good));
    assert(checkConfig(conf).length === 0, "good config");
    writeFileSync(conf, JSON.stringify({ ...good, plugins: { updater: { ...good.plugins.updater, pubkey: PUBKEY_PLACEHOLDER } } }));
    assert(checkConfig(conf).some((x) => /placeholder/.test(x)), "placeholder detected");
    writeFileSync(conf, JSON.stringify({ ...good, plugins: { updater: { ...good.plugins.updater, endpoints: ["https://example.com/latest.json"] } } }));
    assert(checkConfig(conf).some((x) => /endpoints/.test(x)), "foreign endpoint detected");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("make-latest-json selftest: ok");
}

function run(argv) {
  const a = parseArgs(argv);
  if (a.selftest) return selftest();
  if (a["check-config"]) {
    const here = dirname(fileURLToPath(import.meta.url));
    const problems = checkConfig(a.config ?? join(here, "..", "src-tauri", "tauri.conf.json"));
    if (problems.length) {
      for (const p of problems) console.error(`updater config: ${p}`);
      process.exitCode = 1;
    } else console.log("updater config: ok");
    return;
  }
  for (const k of ["version", "tag", "setup", "sig", "out"]) if (!a[k]) throw new Error(`--${k} is required`);
  const notes = a["notes-file"] && existsSync(a["notes-file"]) ? readFileSync(a["notes-file"], "utf8") : "";
  const j = buildLatest({
    version: a.version,
    tag: a.tag,
    setupName: basename(a.setup),
    sigText: readFileSync(a.sig, "utf8"),
    notes,
    repo: a.repo ?? DEFAULT_REPO,
    size: statSync(a.setup).size,
    pubDate: a["pub-date"] ?? new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    baseUrl: a["base-url"],
  });
  writeFileSync(a.out, JSON.stringify(j, null, 2) + "\n");
  console.log(`wrote ${a.out} (${j.version}, ${j.platforms[TARGET].size} bytes)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    run(process.argv.slice(2));
  } catch (e) {
    console.error(`make-latest-json: ${e.message}`);
    process.exit(2);
  }
}
