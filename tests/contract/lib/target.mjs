// Starts the system under test as a child process speaking the stdin/READY contract (architecture 3.3).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export async function startTarget(kind, { testRoot = join(repo, ".testdata", "contract") } = {}) {
  const token = randomBytes(32).toString("hex");
  const artToken = randomBytes(16).toString("hex");
  mkdirSync(join(testRoot, "Local"), { recursive: true });
  mkdirSync(join(testRoot, "Roaming"), { recursive: true });
  const env = { ...process.env, LOCALAPPDATA: join(testRoot, "Local"), APPDATA: join(testRoot, "Roaming"), MINMUSIC_DATA_ROOT: testRoot };

  let child;
  if (kind === "mock") {
    child = spawn(process.execPath, [join(repo, "mock-core", "bin", "sidecar.mjs"), "--parent-pid", String(process.pid)], { env, stdio: ["pipe", "pipe", "pipe"] });
  } else if (kind === "real") {
    const dist = process.env.MINMUSIC_SIDECAR_DIST ?? join(repo, "sidecar", "dist");
    const exe = join(dist, "runtime", "bin", "minmusic-core.exe");
    if (!existsSync(exe)) throw new Error(`real target: ${exe} not found (build the sidecar first, or set MINMUSIC_SIDECAR_DIST)`);
    const fixture = join(repo, "tests", "fixtures", "home.json");
    const seed = join(repo, "tests", "fixtures", "library-seed.json");
    const args = [`@${join(dist, "core.args")}`, "-cp", join(dist, "lib", "*"), "com.metrolist.core.SidecarMainKt",
      "--parent-pid", String(process.pid), "--data-root", join(testRoot, "Local", "MinMusic"), "--log-dir", join(testRoot, "logs"),
      ...(existsSync(fixture) ? ["--fixture-home", fixture] : []), ...(existsSync(seed) ? ["--seed-library", seed] : [])];
    child = spawn(exe, args, { env, cwd: dist, stdio: ["pipe", "pipe", "pipe"] });
  } else throw new Error(`unknown target ${kind}`);

  const log = [];
  child.stderr.on("data", (d) => log.push(d.toString()));
  child.stdin.write(JSON.stringify({ token, artToken, protocol: 1 }) + "\n");

  const ready = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`no READY within 15 s. stderr: ${log.join("").slice(0, 500)}`)), 15000);
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (line.startsWith("READY ")) { clearTimeout(t); res(JSON.parse(line.slice(6))); }
    });
    child.once("exit", (code) => { clearTimeout(t); rej(new Error(`exited ${code} before READY. stderr: ${log.join("").slice(0, 500)}`)); });
  });

  return {
    kind, token, artToken, port: ready.port, pid: ready.pid, ready, testRoot,
    pidFile: join(testRoot, "Local", "MinMusic", "state", "metrolist", "core.pid"),
    readPidFile() { try { return JSON.parse(readFileSync(this.pidFile, "utf8")); } catch { return null; } },
    child,
    async stop() {
      if (child.exitCode !== null) return;
      child.stdin.write(JSON.stringify({ cmd: "shutdown" }) + "\n");
      await new Promise((r) => {
        const t = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } r(); }, 3000);
        child.once("exit", () => { clearTimeout(t); r(); });
      });
    },
  };
}
