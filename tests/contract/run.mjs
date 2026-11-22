#!/usr/bin/env node
// Contract test runner (test-guide section 2).
//   node tests/contract/run.mjs --target mock|real --suite <name>[,<name>...]|all [--only <substring>] [--offline] [--keep]
// <name> is a file in tests/contract/suites (m0, m1-browse, ...). Starts the target as a child process (stdin/READY contract),
// runs every test of the suites over the wire, validating params, results and events against protocol/schema with ajv.
// A suite exports { tests, mockOnly, live }: mockOnly run on the mock target only; live run on the real target only
// (they need network) and are skipped by --offline. Real target: --seed-library / --fixture-home are passed when the files exist.
// Exit code 0 = all green.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startTarget } from "./lib/target.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const target = opt("--target", "mock");
const suite = opt("--suite", "m0");
const only = opt("--only");
if (!["mock", "real"].includes(target) || !["m0", "all"].includes(suite)) {
  console.error("usage: run.mjs --target mock|real --suite m0|all [--only <substring>]");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const available = readdirSync(join(here, "suites")).filter((f) => f.endsWith(".mjs")).sort();
const names = suite === "all" ? available.map((f) => f.replace(".mjs", "")) : suite.split(",").map((x) => x.trim()).filter(Boolean);
const unknown = names.filter((n) => !available.includes(n + ".mjs"));
if (unknown.length) {
  console.error("unknown suite: " + unknown.join(", ") + " (available: " + available.map((f) => f.replace(".mjs", "")).join(", ") + ")");
  process.exit(2);
}
const files = names.map((n) => n + ".mjs");
const plan = [];
for (const f of files) {
  const mod = await import(pathToFileURL(join(here, "suites", f)).href);
  for (const [name, fn] of mod.tests ?? []) plan.push([`${f.replace(".mjs", "")}: ${name}`, fn]);
  if (target === "mock") for (const [name, fn] of mod.mockOnly ?? []) plan.push([`${f.replace(".mjs", "")}: ${name}`, fn]);
  if (target === "real" && !offline) for (const [name, fn] of mod.live ?? []) plan.push([`${f.replace(".mjs", "")}: [live] ${name}`, fn]);
}

const t = await startTarget(target);
console.log(`target=${target} port=${t.port} pid=${t.pid} suite=${suite} tests=${plan.length}`);
const ctx = { target: t, port: t.port, token: t.token, artToken: t.artToken, cleanup: [] };

let pass = 0;
const failed = [];
const t0 = Date.now();
for (const [name, fn] of plan) {
  if (only && !name.includes(only)) continue;
  const s = Date.now();
  try {
    await Promise.race([
      Promise.resolve(fn(ctx)),
      new Promise((_, rej) => setTimeout(() => rej(new Error("test timeout (30 s)")), 30000)),
    ]);
    pass++;
    console.log(`  ok   ${name} (${Date.now() - s} ms)`);
  } catch (e) {
    failed.push(name);
    console.log(`  FAIL ${name}\n       ${String(e?.stack ?? e).split("\n").slice(0, 4).join("\n       ")}`);
  } finally {
    for (const c of ctx.cleanup.splice(0)) try { c(); } catch { /* ignore */ }
  }
}
await t.stop();
console.log(`\n${pass} passed, ${failed.length} failed, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failed.length ? 1 : 0);
