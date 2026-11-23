import { test, expect, chromium } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

// U-3-local (test-guide section 7): update v2.0.0 -> newer through the Tauri updater while a queue exists,
// served from a LOCAL http server with a THROWAWAY minisign key. Integration run only (INT-W5); it starts and
// stops its own app instances, so it does not use the `app` fixture and needs no app started by e2e.ps1.
//
// Inputs (the spec is skipped unless all are set):
//   MM_UPD_OLD_EXE      an INSTALLED e2e build (cargo feature `e2e`, built with
//                       `--config tests/fixtures/updater/e2e.tauri.conf.json`) of the OLD version, under .testdata
//                       (install the old setup with /D=<repo>\.testdata\<id>\install).
//   MM_UPD_NEW_SETUP    the NSIS setup of the NEW version, built the same way (an e2e build).
//   MM_UPD_NEW_VERSION  its version, e.g. 2.0.1 (must equal the version baked into that setup).
// Optional: MM_UPD_PORT (default 48017), MM_UPD_TRACK (a video id the core can resolve, default dQw4w9WgXcQ),
//           MM_UPD_CLI (default "cargo tauri").
// The setup is run only with /D=<dir of MM_UPD_OLD_EXE>, never into the owner's install. The throwaway key
// lives in .testdata/<run>/updater and is never committed (.testdata is git-ignored).

const OLD = process.env.MM_UPD_OLD_EXE;
const SETUP = process.env.MM_UPD_NEW_SETUP;
const NEW_VERSION = process.env.MM_UPD_NEW_VERSION;
const PORT = Number(process.env.MM_UPD_PORT ?? 48017);
const TRACK = process.env.MM_UPD_TRACK ?? 'dQw4w9WgXcQ';

test.skip(!OLD || !SETUP || !NEW_VERSION, 'MM_UPD_OLD_EXE / MM_UPD_NEW_SETUP / MM_UPD_NEW_VERSION not set (INT-W5 provides them)');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const run = `m5-2-${new Date().toISOString().replace(/\W/g, '').slice(0, 14)}`;
const work = path.join(repoRoot, '.testdata', run);
const dataRoot = path.join(work, 'data');
const keyDir = path.join(work, 'updater');

function cli(args: string[]) {
  const [bin, ...pre] = (process.env.MM_UPD_CLI ?? 'cargo tauri').split(' ');
  return execFileSync(bin, [...pre, ...args], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

type Started = { child: ChildProcess; port: number; pidfile: string };
let devPort = 9400;

function startApp(pubkey: string): Started {
  const port = devPort++;
  const pidfile = path.join(work, `pids-${port}.json`);
  const child = spawn(OLD!, [], {
    env: {
      ...process.env,
      MINMUSIC_DATA_ROOT: dataRoot,
      MINMUSIC_DEVTOOLS_PORT: String(port),
      MINMUSIC_TEST_PIDFILE: pidfile,
      MINMUSIC_UPDATER_ENDPOINT: `http://127.0.0.1:${PORT}/latest.json`,
      MINMUSIC_UPDATER_PUBKEY: pubkey,
    },
    stdio: 'ignore',
    detached: false,
  });
  return { child, port, pidfile };
}

async function mainPage(port: number) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  for (let i = 0; i < 60; i++) {
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !/#\/mini/.test(p.url()) && !p.url().startsWith('devtools:'));
    if (page) return { browser, page };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('main window not found');
}

async function connectApp(port: number) {
  for (let i = 0; i < 40; i++) {
    try {
      return await mainPage(port);
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`no devtools endpoint on ${port}`);
}

/** One core request over the real WebSocket (api.md 1.3), through the page so the token never leaves the app. */
async function coreCall<T>(page: import('@playwright/test').Page, m: string, p: object = {}): Promise<T> {
  return page.evaluate(
    async ([method, params]) => {
      const cfg = await (window as any).__TAURI__.core.invoke('core_config');
      const ws = new WebSocket(`ws://127.0.0.1:${cfg.port}/rpc`);
      await new Promise((res, rej) => { ws.onopen = () => res(null); ws.onerror = () => rej(new Error('ws')); });
      const call = (id: number, mm: string, pp: object) =>
        new Promise<any>((res) => {
          const h = (ev: MessageEvent) => { const o = JSON.parse(String(ev.data)); if (o.id === id) { ws.removeEventListener('message', h); res(o); } };
          ws.addEventListener('message', h);
          ws.send(JSON.stringify({ id, m: mm, p: pp }));
        });
      const hello = await call(1, 'sys.hello', { token: cfg.token, role: 'ui', protocol: 1, client: 'e2e/m5-2', locale: 'vi' });
      if (hello.e) throw new Error(JSON.stringify(hello.e));
      const r = await call(2, method as string, params as object);
      ws.close();
      if (r.e) throw new Error(JSON.stringify(r.e));
      return r.r;
    },
    [m, p] as const,
  ) as Promise<T>;
}

test('U-3-local: check -> download -> graceful quit -> new version starts, queue restored', async () => {
  test.setTimeout(10 * 60_000);
  fs.mkdirSync(keyDir, { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });

  // 1. throwaway key + signature + latest.json (version, notes, size from make-latest-json)
  const key = path.join(keyDir, 'throwaway.key');
  cli(['signer', 'generate', '--ci', '-p', '', '-w', key, '-f']);
  const pubkey = fs.readFileSync(`${key}.pub`, 'utf8').trim();
  const served = path.join(keyDir, 'serve');
  fs.mkdirSync(served, { recursive: true });
  const setupName = `MinMusic-${NEW_VERSION}-windows-x64-setup.exe`;
  fs.copyFileSync(SETUP!, path.join(served, setupName));
  cli(['signer', 'sign', '-f', key, '-p', '', path.join(served, setupName)]);
  fs.writeFileSync(path.join(work, 'notes.md'), '## Test release\n\n- served from 127.0.0.1\n');
  execFileSync(process.execPath, [
    path.join(repoRoot, 'scripts', 'make-latest-json.mjs'),
    '--version', NEW_VERSION!, '--tag', `v${NEW_VERSION}`, '--setup', path.join(served, setupName),
    '--sig', path.join(served, `${setupName}.sig`), '--notes-file', path.join(work, 'notes.md'),
    '--base-url', `http://127.0.0.1:${PORT}`, '--out', path.join(served, 'latest.json'),
  ], { stdio: 'inherit' });

  // 2. local server (loopback only)
  const server = http.createServer((req, res) => {
    const f = path.join(served, path.basename((req.url ?? '/').split('?')[0]));
    if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-length', fs.statSync(f).size);
    fs.createReadStream(f).pipe(res);
  });
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));

  let app: Started | undefined;
  let app2: Started | undefined;
  const pids: number[] = [];
  try {
    // 3. old app: put something in the queue
    app = startApp(pubkey);
    const a = await connectApp(app.port);
    await expect.poll(async () => (await a.page.evaluate(() => (window as any).__TAURI__.core.invoke('core_status'))).state, { timeout: 90_000 }).toBe('ready');
    await coreCall(a.page, 'queue.add', { ids: [TRACK], position: 'end' });
    const before = await coreCall<{ total: number }>(a.page, 'queue.window', { offset: 0, limit: 10 });
    expect(before.total).toBeGreaterThanOrEqual(1);
    const ids = JSON.parse(fs.readFileSync(app.pidfile, 'utf8')) as { shellPid: number; corePid: number };
    pids.push(ids.shellPid, ids.corePid);

    // 4. check -> available -> install
    const st = await a.page.evaluate(() => (window as any).__TAURI__.core.invoke('update_check'));
    expect(st.state).toBe('idle');
    expect(st.available.version).toBe(NEW_VERSION);
    expect(st.available.notes).toContain('Test release');
    expect(st.available.size).toBeGreaterThan(0);
    await a.page.evaluate(() => (window as any).__TAURI__.core.invoke('update_install'));
    await a.browser.close().catch(() => {});

    // 5. graceful quit: the old shell and the core are gone (never an orphan JVM) and the installer ran
    await expect.poll(() => pids.every((p) => !alive(p)), { timeout: 120_000 }).toBe(true);

    // 6. the passive installer replaced the files and relaunched the app (same env, so the same devtools port);
    //    if nothing answers there we start the installed exe ourselves.
    let b: Awaited<ReturnType<typeof connectApp>>;
    try {
      b = await connectApp(app.port);
    } catch {
      app2 = startApp(pubkey);
      b = await connectApp(app2.port);
    }
    await expect.poll(async () => (await b.page.evaluate(() => (window as any).__TAURI__.core.invoke('core_status'))).state, { timeout: 90_000 }).toBe('ready');
    const after = await coreCall<{ total: number }>(b.page, 'queue.window', { offset: 0, limit: 10 });
    expect(after.total).toBe(before.total);
    const info = await coreCall<{ version: string }>(b.page, 'app.info');
    expect(info.version.startsWith(NEW_VERSION!)).toBe(true);
    const st2 = await b.page.evaluate(() => (window as any).__TAURI__.core.invoke('update_check'));
    expect(st2.available ?? null).toBeNull();
    await b.browser.close().catch(() => {});
  } finally {
    // kill only the PIDs we started
    for (const x of [app, app2]) {
      try { const j = JSON.parse(fs.readFileSync(x!.pidfile, 'utf8')); pids.push(j.shellPid, j.corePid); } catch { /* not started */ }
      try { x?.child.kill(); } catch { /* gone */ }
    }
    for (const p of new Set(pids)) { try { process.kill(p); } catch { /* gone */ } }
    server.close();
  }
});

function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
