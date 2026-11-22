import { test, expect } from '../fixtures/app';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// M3-1: shell.webLogin and shell.po.* through the e2e commands `test_weblogin` / `test_po_evaluate`
// (the same code path as the core's SrvReq). Runs against the real app via scripts/e2e.ps1 -Suite app.
const PORT = 48006;
const BASE = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;

const tempLoginDirs = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('MinMusic-login-'));

const req = (url: string, extra: object = {}) => ({
  url,
  allowedHosts: ['127.0.0.1'],
  title: 'Fixture login',
  window: { w: 640, h: 480, maximizable: false },
  done: { cookies: { names: ['test_sid'], urls: [BASE] } },
  collect: { cookieUrls: [BASE] },
  timeoutMs: 20000,
  ...extra,
});

test.beforeAll(async () => {
  server = spawn(process.execPath, [path.join('tests', 'fixtures', 'weblogin', 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/login.html`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('fixture server did not start');
});
test.afterAll(() => {
  server?.kill(); // only the child we started
});

test('webLogin returns the httpOnly cookie and deletes the data dir', async ({ app }) => {
  const before = tempLoginDirs();
  const r = await app.invoke<any>('test_weblogin', { request: req(`${BASE}/login.html?auto=1`) });
  expect(r.cancelled).toBeUndefined();
  expect(r.cookies.test_sid).toBe('fixture-sid-123');
  expect(r.cookieHeader).toMatch(/^test_sid=fixture-sid-123/);
  expect(r.finalUrl).toContain('/done.html');
  const after = tempLoginDirs().filter((n) => !before.includes(n));
  expect(after).toEqual([]);
});

test('a second concurrent webLogin is busy; the first times out as cancelled', async ({ app }) => {
  const first = app.invoke<any>('test_weblogin', { request: req(`${BASE}/login.html`, { timeoutMs: 5000 }) });
  await new Promise((r) => setTimeout(r, 1500));
  await expect(app.invoke('test_weblogin', { request: req(`${BASE}/login.html`) })).rejects.toThrow(/busy/);
  expect(await first).toEqual({ cancelled: true });
  expect(tempLoginDirs().length).toBe(0);
});

test('po.evaluate returns the raw JSON string', async ({ app }) => {
  // needs network access to https://www.youtube.com/robots.txt
  expect(await app.invoke<string>('test_po_evaluate', { script: '1+1' })).toBe('2');
});
