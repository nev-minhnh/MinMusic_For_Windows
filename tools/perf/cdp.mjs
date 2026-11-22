#!/usr/bin/env node
// Minimal CDP / core RPC helper for the PowerShell scripts (no Playwright needed).
//   node cdp.mjs --port 9222 eval "<js expression>"        -> prints JSON of the (awaited) value
//   node cdp.mjs --port 9222 core <method> ['<json params>'] -> opens ws://127.0.0.1:<corePort>/rpc with the
//                                    token from window.__MM_CORE__, sys.hello role=ui, prints the result JSON
//   node cdp.mjs --port 9222 shot <file.png>                -> Page.captureScreenshot (CDP only)
// Exit code 0 ok, 1 error (message on stderr).
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const pi = argv.indexOf('--port');
const port = pi >= 0 ? argv.splice(pi, 2)[1] : '9222';
const [cmd, ...rest] = argv;

async function pageWs() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pages = list.filter((t) => t.type === 'page' && !/#\/mini/.test(t.url) && t.webSocketDebuggerUrl);
  if (!pages.length) throw new Error('no page target');
  return pages[0].webSocketDebuggerUrl;
}

function cdpSession(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('cdp ws error')); });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
  };
  return { open, close: () => ws.close(), send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }) };
}

async function evaluate(s, expression) {
  const r = await s.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function coreCall(corePort, token, method, params) {
  const ws = new WebSocket(`ws://127.0.0.1:${corePort}/rpc`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('core ws error')); });
  let id = 0;
  const pending = new Map();
  let onEvent = null;
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.ev && onEvent) onEvent(d); };
  const call = (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, m, p })); setTimeout(() => rej(new Error('core timeout ' + m)), 15000); });
  const hello = await call('sys.hello', { token, role: 'ui', protocol: 1, client: 'e2e/0.1', locale: 'vi' });
  if (hello.e) throw new Error('hello: ' + JSON.stringify(hello.e));
  if (method.startsWith('sub:')) { // sub:<topic> -> first (snapshot) event payload
    const first = new Promise((res, rej) => { onEvent = res; setTimeout(() => rej(new Error('no snapshot')), 8000); });
    const so = await call('sub.open', { topic: method.slice(4), params });
    if (so.e) throw new Error(JSON.stringify(so.e));
    const ev = await first;
    ws.close();
    return ev;
  }
  const r = await call(method, params);
  ws.close();
  if (r.e) throw new Error(JSON.stringify(r.e));
  return r.r;
}

try {
  const s = cdpSession(await pageWs());
  await s.open;
  let out;
  if (cmd === 'eval') out = await evaluate(s, rest[0]);
  else if (cmd === 'core') {
    const cfg = await evaluate(s, 'JSON.stringify(window.__MM_CORE__ || null)');
    const c = JSON.parse(cfg);
    if (!c) throw new Error('window.__MM_CORE__ not set');
    out = await coreCall(c.port, c.token, rest[0], rest[1] ? JSON.parse(rest[1]) : {});
  } else if (cmd === 'watch') {
    // watch <ms>: poll core_status every 50 ms, print [{t,state}] for each distinct state seen
    const until = Date.now() + Number(rest[0] || 5000);
    const t0 = Date.now();
    const seen = [];
    while (Date.now() < until) {
      try {
        const v = await evaluate(s, "window.__TAURI__.core.invoke('core_status')");
        const st = typeof v === 'string' ? v : v && v.state;
        if (!seen.length || seen[seen.length - 1].state !== st) seen.push({ t: Date.now() - t0, state: st });
      } catch (e) {
        if (!seen.length || seen[seen.length - 1].state !== 'cdp-error') seen.push({ t: Date.now() - t0, state: 'cdp-error' });
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    out = seen;
  } else if (cmd === 'shot') {
    const r = await s.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(rest[0]), { recursive: true });
    fs.writeFileSync(rest[0], Buffer.from(r.data, 'base64'));
    out = { file: rest[0] };
  } else throw new Error('usage: cdp.mjs --port N eval|core|shot ...');
  s.close();
  console.log(JSON.stringify(out ?? null));
  process.exit(0);
} catch (e) {
  console.error(String(e.message || e));
  process.exit(1);
}
