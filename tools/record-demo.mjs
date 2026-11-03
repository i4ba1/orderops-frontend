// Records the actual running application. No mocked routes or synthetic API responses.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.ORDEROPS_DEMO_URL;
if (!base) throw new Error('Set ORDEROPS_DEMO_URL to an isolated running OrderOps stack. The recording reserves three real stock units.');
const target = new URL(base);
if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
  throw new Error('ORDEROPS_DEMO_URL must be an HTTP(S) address without embedded credentials.');
}
const health = await fetch(new URL('/api/csrf', target), { signal: AbortSignal.timeout(5_000) });
if (!health.ok) throw new Error(`Order Service preflight failed: HTTP ${health.status}`);

const output = resolve(process.env.ORDEROPS_DEMO_OUTPUT ?? '.cache/demo');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  baseURL: target.origin,
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: output, size: { width: 1440, height: 1000 } },
});
const page = await context.newPage();
const started = Date.now();
const chapters = [];
let complete = false;
try {
  await page.goto('/');
  await page.getByLabel('Username').fill(process.env.ORDEROPS_DEMO_USERNAME ?? 'operator');
  await page.getByLabel('Password').fill(process.env.ORDEROPS_DEMO_PASSWORD ?? 'operator-local-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
  const inventoryResponse = await page.request.get('/api/inventory');
  expect(inventoryResponse.ok()).toBeTruthy();
  const product = (await inventoryResponse.json()).find(item => item.availableQuantity >= 3);
  if (!product) throw new Error('The demo needs one inventory SKU with at least three units.');
  const initialStock = product.availableQuantity;
  const orders = [];

  async function caption(second, title, description) {
    const wait = second * 1000 - (Date.now() - started);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    chapters.push({ atSeconds: Math.round((Date.now() - started) / 1000), title });
    await page.evaluate(({ title, description }) => {
      let panel = document.getElementById('orderops-recording-caption');
      if (!panel) {
        panel = document.createElement('aside');
        panel.id = 'orderops-recording-caption';
        Object.assign(panel.style, { position: 'fixed', bottom: '12px', left: '24px', right: '24px', padding: '14px 22px', background: '#112936', color: 'white', zIndex: '99999', borderRadius: '12px', font: '16px system-ui', pointerEvents: 'none' });
        document.body.append(panel);
      }
      panel.replaceChildren();
      const heading = document.createElement('strong');
      heading.textContent = title;
      const detail = document.createElement('div');
      detail.textContent = description;
      panel.append(heading, detail);
    }, { title, description });
  }
  async function stock() {
    const response = await page.request.get('/api/inventory');
    expect(response.ok()).toBeTruthy();
    return (await response.json()).find(item => item.sku === product.sku).availableQuantity;
  }
  async function read(order) {
    const response = await page.request.get(`/api/orders/${order.id}`);
    expect(response.ok()).toBeTruthy();
    return response.json();
  }
  async function create(scenario) {
    await page.getByRole('button', { name: 'New order', exact: true }).click();
    const reference = `DEMO-${scenario}-${crypto.randomUUID().slice(0, 8)}`;
    for (const [label, value] of Object.entries({ 'Customer reference': reference, Recipient: 'Ada Lovelace', 'Street address': '10 Example Street', City: 'London', 'Postal code': 'SW1A 1AA', 'Country code': 'GB' })) {
      await page.getByLabel(label).fill(value);
    }
    await page.getByRole('combobox', { name: 'Product 1', exact: true }).selectOption(product.sku);
    await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption(scenario);
    const pending = page.waitForResponse(response => response.url().endsWith('/api/orders') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create order', exact: true }).click();
    const response = await pending;
    expect(response.status()).toBe(201);
    const order = await response.json();
    await expect(page.getByRole('dialog', { name: `Order ${reference}` })).toBeVisible();
    orders.push({ id: order.id, scenario });
    return { ...order, requestKey: response.request().headers()['idempotency-key'], requestBody: response.request().postDataJSON() };
  }
  async function waitFor(order, status) {
    await expect.poll(async () => (await read(order)).status, { timeout: 70_000, intervals: [1000, 2000] }).toBe(status);
    if (status === 'SHIPMENT_CREATED') {
      const current = await read(order);
      await expect(page.getByText(current.trackingNumber, { exact: true })).toBeVisible({ timeout: 15_000 });
    }
  }

  await caption(0, 'OrderOps · live product demonstration', 'Java Order Service + Fulfillment Service · PostgreSQL · Kafka · React. All actions use the running services.');
  await caption(40, '1 · Reserve stock and create a shipment', 'Order creation commits the reservation and outgoing event together. Shipment created means carrier acceptance, not delivery.');
  const normal = await create('NORMAL');
  await waitFor(normal, 'SHIPMENT_CREATED');
  expect(await stock()).toBe(initialStock - 1);

  await caption(85, '2 · Replay safely after a lost response', 'Replaying the same key and payload must return the same order without reserving stock again.');
  const csrfResponse = await page.request.get('/api/csrf');
  const csrf = await csrfResponse.json();
  const replay = await page.request.post('/api/orders', { headers: { [csrf.headerName]: csrf.token, 'Idempotency-Key': normal.requestKey }, data: normal.requestBody });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).id).toBe(normal.id);
  expect(await stock()).toBe(initialStock - 1);
  await caption(105, 'Replay verified: same order · stock reserved once', 'The recorder asserted HTTP 200, the original order ID, and unchanged available stock.');
  await page.getByRole('button', { name: 'Close order details' }).click();

  await caption(130, '3 · Recover a carrier outage', 'Three transient carrier failures exhaust automatic retries. Operator recovery starts a new generation.');
  const failed = await create('FAIL_THEN_RECOVER');
  await waitFor(failed, 'FULFILLMENT_FAILED');
  await page.getByRole('button', { name: 'Retry fulfillment' }).click({ timeout: 15_000 });
  await waitFor(failed, 'SHIPMENT_CREATED');
  expect((await read(failed)).attemptGeneration).toBe(2);
  expect(await stock()).toBe(initialStock - 2);
  await page.getByRole('button', { name: 'Close order details' }).click();

  await caption(195, '4 · Reconcile a lost carrier response', 'The carrier persists a shipment, then times out. Retrying with the stable order key recovers that shipment.');
  const timedOut = await create('TIMEOUT_AFTER_CREATE');
  await waitFor(timedOut, 'SHIPMENT_CREATED');
  const reconciled = await read(timedOut);
  expect(reconciled.attemptGeneration).toBe(1);
  expect(reconciled.timeline.filter(event => event.type === 'ShipmentCreated')).toHaveLength(1);
  expect(await stock()).toBe(initialStock - 3);

  await caption(245, 'Engineering evidence', 'Transactional outboxes · consumer deduplication · durable leases · generation checks · CSRF and server-side roles.');
  await page.getByRole('button', { name: 'Close order details' }).click();
  await caption(275, 'Tradeoffs and verification', 'Single-host demo; no high availability. Review integration tests, API contracts and deployment evidence alongside this recording.');
  const remaining = 300_000 - (Date.now() - started);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify({ recordedAt: new Date().toISOString(), durationSeconds: Math.round((Date.now() - started) / 1000), origin: target.origin, chapters, orders, stockReserved: 3, transport: 'real-stack', claims: ['normal shipment', 'identical replay reserves once', 'manual recovery reaches generation 2', 'carrier timeout reconciles'] }, null, 2));
  complete = true;
} finally {
  await context.close();
  await browser.close();
  const video = page.video();
  if (video) await video.saveAs(resolve(output, complete ? 'orderops-demo.webm' : 'orderops-demo-incomplete.webm'));
}
console.log(`Completed real-stack recording: ${resolve(output, 'orderops-demo.webm')}`);
