import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError, RequestIntent } from '../src/api.ts';

test('login obtains CSRF before login, sends session cookies, and renews the token after login', async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const client = new ApiClient(async (input, options) => {
    calls.push({ url: String(input), options });
    return String(input) === '/api/csrf'
      ? Response.json({ headerName: 'X-CSRF-TOKEN', token: calls.length === 1 ? 'before' : 'after' })
      : new Response(null, { status: 204 });
  });
  await client.login('operator', 'a&b=secret');
  await client.logout();
  assert.deepEqual(calls.map(c => c.url), ['/api/csrf', '/login', '/api/csrf', '/logout']);
  assert.equal(new Headers(calls[1].options?.headers).get('X-CSRF-TOKEN'), 'before');
  assert.equal(new Headers(calls[3].options?.headers).get('X-CSRF-TOKEN'), 'after');
  assert.equal(new URLSearchParams(String(calls[1].options?.body)).get('password'), 'a&b=secret');
  assert.ok(calls.every(c => c.options?.credentials === 'same-origin'));
});

test('mutation passes an idempotency key and does not automatically replay an uncertain result', async () => {
  let attempts = 0;
  const client = new ApiClient(async (input, options) => {
    if (String(input) === '/api/csrf') return Response.json({ headerName: 'X-CSRF-TOKEN', token: 'csrf' });
    attempts++;
    assert.equal(new Headers(options?.headers).get('Idempotency-Key'), 'same-request-key');
    throw new TypeError('Connection lost');
  });
  await assert.rejects(client.createOrder({} as never, 'same-request-key'), (error: unknown) => error instanceof ApiError && error.uncertain);
  assert.equal(attempts, 1);
});

test('uncertain server responses and non-JSON responses retain an actionable error', async () => {
  const client = new ApiClient(async () => new Response('<html>upstream error</html>', { status: 502 }));
  await assert.rejects(client.session(), (error: unknown) => error instanceof ApiError && error.status === 502 && error.uncertain && !error.message.includes('<html>'));
  const invalid = new ApiClient(async () => new Response('invalid JSON', { status: 200 }));
  await assert.rejects(invalid.session(), (error: unknown) => error instanceof ApiError && error.uncertain);
});

test('validation failures expose the server detail and are definitive', async () => {
  const client = new ApiClient(async () => Response.json({ detail: 'Insufficient stock for COFFEE' }, { status: 409 }));
  await assert.rejects(client.orders(0), (error: unknown) => error instanceof ApiError && !error.uncertain && error.message === 'Insufficient stock for COFFEE');
});

test('request identity survives reload and forbids editing an unresolved request', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const payload = { customerReference: 'REF-1', items: [{ sku: 'COFFEE', quantity: 2 }] };
  const first = new RequestIntent<typeof payload>('operator:create', storage);
  const key = first.begin(payload).key;
  const reloaded = new RequestIntent<typeof payload>('operator:create', storage);
  assert.equal(reloaded.current?.key, key);
  assert.equal(reloaded.begin(payload).key, key);
  assert.throws(() => reloaded.begin({ ...payload, customerReference: 'REF-2' }), /unresolved/i);
  reloaded.clear();
  assert.notEqual(reloaded.begin(payload).key, key);
});

test('order list page is encoded and retry requests use the original operation key', async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const client = new ApiClient(async (input, options) => {
    calls.push({ url: String(input), options });
    return Response.json(String(input) === '/api/csrf' ? { headerName: 'X-CSRF-TOKEN', token: 'csrf' } : {});
  });
  await client.orders(2);
  await client.retry('order/1', 'retry-operation-key');
  assert.equal(calls[0].url, '/api/orders?page=2&size=10');
  assert.equal(calls[2].url, '/api/orders/order%2F1/retry');
  assert.equal(new Headers(calls[2].options?.headers).get('Idempotency-Key'), 'retry-operation-key');
});
