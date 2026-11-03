import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createDevServer } from '../tools/dev-server.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
function send(url, path, headers = {}, method = 'GET', body = '') {
  return new Promise((resolve, reject) => {
    const req = request(url + path, { method, headers }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
test('development proxy preserves session, CSRF, request identity, payload and backend status', async t => {
  const backend = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.writeHead(409, { 'set-cookie': ['SESSION=renewed; HttpOnly', 'XSRF-TOKEN=renewed'], 'content-type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, url: req.url, cookie: req.headers.cookie, csrf: req.headers['x-csrf-token'], key: req.headers['idempotency-key'], body }));
    });
  });
  const apiTarget = await listen(backend);
  const proxy = createDevServer({ apiTarget, files: () => new Map() });
  t.after(() => { proxy.closeAllConnections(); proxy.close(); backend.closeAllConnections(); backend.close(); });
  const url = await listen(proxy);
  for (const path of ['/api/orders?page=2', '/login', '/logout']) {
    const result = await send(url, path, { cookie: 'SESSION=original', 'x-csrf-token': 'token', 'idempotency-key': 'stable', 'content-type': 'application/json' }, 'POST', '{"sku":"SKU-1"}');
    assert.equal(result.status, 409);
    assert.deepEqual(result.headers['set-cookie'], ['SESSION=renewed; HttpOnly', 'XSRF-TOKEN=renewed']);
    assert.deepEqual(JSON.parse(result.body), { method: 'POST', url: path, cookie: 'SESSION=original', csrf: 'token', key: 'stable', body: '{"sku":"SKU-1"}' });
  }
});
test('development server rejects foreign hosts, origins and traversal, and serves only known assets', async t => {
  const files = new Map([['/index.html', { body: Buffer.from('<html>app</html>'), type: 'text/html' }], ['/assets/main.js', { body: Buffer.from('app()'), type: 'text/javascript' }]]);
  const proxy = createDevServer({ apiTarget: 'http://127.0.0.1:1', files: () => files });
  t.after(() => { proxy.closeAllConnections(); proxy.close(); });
  const url = await listen(proxy);
  assert.equal((await send(url, '/', { host: 'evil.example' })).status, 403);
  assert.equal((await send(url, '/api/orders', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await send(url, '/%2e%2e%5cpackage.json')).status, 400);
  assert.equal((await send(url, '/package.json')).status, 404);
  assert.equal((await send(url, '/assets/missing.js')).status, 404);
  assert.equal((await send(url, '/assets/main.js')).body, 'app()');
  assert.equal((await send(url, '/orders', { accept: 'text/html' })).body, '<html>app</html>');
  assert.equal((await send(url, '/api/orders')).status, 502);
});
