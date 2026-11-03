import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export function createDevServer({ apiTarget, files }) {
  const target = new URL(apiTarget);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('ORDEROPS_API_TARGET must be an HTTP(S) origin without credentials');
  }
  return createServer((request, response) => {
    const reject = status => { response.writeHead(status); response.end(); };
    const host = request.headers.host;
    if (!host || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return reject(403);
    if (request.headers.origin && request.headers.origin !== `http://${host}`) return reject(403);
    let path;
    try {
      path = decodeURIComponent((request.url ?? '/').split('?')[0]);
    } catch { return reject(400); }
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('\0') || path.split('/').includes('..')) return reject(400);
    if (/^\/api(?:\/|$)/.test(path) || path === '/login' || path === '/logout') {
      const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const upstream = send({ protocol: target.protocol, hostname: target.hostname, port: target.port, path: request.url, method: request.method, headers: { ...request.headers, host: target.host } }, result => {
        response.writeHead(result.statusCode ?? 502, result.headers);
        result.pipe(response);
      });
      upstream.setTimeout(30_000, () => upstream.destroy());
      upstream.on('error', () => { if (!response.headersSent) reject(502); else response.destroy(); });
      request.on('aborted', () => upstream.destroy());
      response.on('close', () => upstream.destroy());
      request.pipe(upstream);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) return reject(405);
    const current = files();
    const asset = current.get(path === '/' ? '/index.html' : path) ??
      (!path.includes('.') && request.headers.accept?.includes('text/html') ? current.get('/index.html') : undefined);
    if (!asset) return reject(404);
    response.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : asset.body);
  });
}
