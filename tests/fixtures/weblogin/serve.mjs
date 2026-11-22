// Tiny fixture server: `node tests/fixtures/weblogin/serve.mjs <port>`. Binds 127.0.0.1 only.
// /done.html is served with `Set-Cookie: test_sid=...; HttpOnly`, so the cookie is only visible through
// the WebView2 cookie manager, not to page scripts.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 0);
const files = { '/login.html': 'login.html', '/done.html': 'done.html' };

const server = http.createServer((req, res) => {
  const p = new URL(req.url ?? '/', 'http://x').pathname;
  const f = files[p];
  if (!f) {
    res.writeHead(404).end('not found');
    return;
  }
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (p === '/done.html') headers['set-cookie'] = ['test_sid=fixture-sid-123; Path=/; HttpOnly', 'test_plain=plain-456; Path=/'];
  res.writeHead(200, headers).end(fs.readFileSync(path.join(dir, f)));
});
server.listen(port, '127.0.0.1', () => {
  console.log(`weblogin fixture on http://127.0.0.1:${server.address().port}`);
});
