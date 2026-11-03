# Frontend security

Production serves static assets through nginx and proxies API requests on the same origin. Preserve session cookies and CSRF; the backend enforces viewer/operator permissions. Credentials do not belong in the static bundle.

## Dependency audit — 2026-11-03

Vite and its dependency chain have been removed. The frontend now uses esbuild 0.27.7 for bundling and a small loopback-only Node server for development. A fresh `npm audit --audit-level=high` completed with exit 0: no high, critical or moderate findings; one low finding remains.

The remaining [esbuild advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr) concerns its Windows file-serving implementation. This project does not call esbuild's `serve` API: our Node server serves only explicitly bundled/public assets from an in-memory map, rejects traversal and foreign Host/Origin headers, and proxies only API/login/logout routes. That avoids the reported serving path, but the dependency still appears in audit. Updating to 0.28.2 was attempted and the package download was denied (EACCES); no lock metadata was fabricated.

## Development server

`tools/dev-server.mjs` binds through the CLI to 127.0.0.1 and preserves cookies, CSRF, idempotency headers and backend status codes. HTTP boundary tests cover those behaviors, foreign hosts/origins, missing assets, traversal and upstream failure. It is a development tool; production continues to use nginx.

CI keeps `npm audit --audit-level=high` as a release gate. Repeat the audit for each release; this report is not a guarantee against future advisories.
