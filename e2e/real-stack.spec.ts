import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { CreateOrder, InventoryItem, Order } from '../src/api';

// This project deliberately uses the running nginx/Order Service/Kafka/fulfillment/carrier stack.
// No page.route, fixture transport, or replacement API is used here.
test('real stack reserves once, recovers failed fulfillment and reconciles a carrier timeout', async ({ page }) => {
  test.setTimeout(180_000);
  expect(process.env.ORDEROPS_E2E_URL, 'Set ORDEROPS_E2E_URL to the running web endpoint').toBeTruthy();
  await page.goto('/');
  await page.getByLabel('Username').fill(process.env.ORDEROPS_E2E_USERNAME ?? 'operator');
  await page.getByLabel('Password').fill(process.env.ORDEROPS_E2E_PASSWORD ?? 'operator-local-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
  const inventoryResponse = await page.request.get('/api/inventory');
  expect(inventoryResponse.ok()).toBeTruthy();
  const inventory = await inventoryResponse.json() as InventoryItem[];
  const product = inventory.find(item => item.availableQuantity >= 3);
  expect(product, 'Seed at least one SKU with three available units').toBeTruthy();
  const sku = product!.sku;
  const initialStock = product!.availableQuantity;

  async function stock() {
    const response = await page.request.get('/api/inventory');
    expect(response.ok()).toBeTruthy();
    return (await response.json() as InventoryItem[]).find(item => item.sku === sku)!.availableQuantity;
  }
  async function read(id: string) {
    const response = await page.request.get(`/api/orders/${id}`);
    expect(response.ok()).toBeTruthy();
    return await response.json() as Order;
  }
  async function create(scenario: CreateOrder['demoScenario']) {
    await page.getByRole('button', { name: 'New order', exact: true }).click();
    const reference = `E2E-${scenario}-${crypto.randomUUID().slice(0, 8)}`;
    await fillOrder(page, reference, sku, scenario);
    const pending = page.waitForResponse(response => response.url().endsWith('/api/orders') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create order', exact: true }).click();
    const response = await pending;
    expect(response.status()).toBe(201);
    const order = await response.json() as Order;
    await expect(page.getByRole('dialog', { name: `Order ${reference}` })).toBeVisible();
    return { order, key: response.request().headers()['idempotency-key'], payload: response.request().postDataJSON() as CreateOrder };
  }

  const failed = await create('FAIL_THEN_RECOVER');
  await expect.poll(async () => (await read(failed.order.id)).status, { timeout: 70_000, intervals: [1_000, 2_000] }).toBe('FULFILLMENT_FAILED');
  await expect.poll(stock).toBe(initialStock - 1);
  const csrfResponse = await page.request.get('/api/csrf');
  const csrf = await csrfResponse.json() as { headerName: string; token: string };
  const replay = await page.request.post('/api/orders', { headers: { [csrf.headerName]: csrf.token, 'Idempotency-Key': failed.key }, data: failed.payload });
  expect(replay.status()).toBe(200);
  expect((await replay.json() as Order).id).toBe(failed.order.id);
  expect(await stock()).toBe(initialStock - 1);
  await page.getByRole('button', { name: 'Retry fulfillment' }).click({ timeout: 15_000 });
  await expect.poll(async () => (await read(failed.order.id)).status, { timeout: 60_000, intervals: [1_000, 2_000] }).toBe('SHIPMENT_CREATED');
  const recovered = await read(failed.order.id);
  expect(recovered.attemptGeneration).toBe(2);
  expect(recovered.timeline.some(event => event.type === 'RetryRequested')).toBeTruthy();
  expect(recovered.shipmentId).toBeTruthy();
  await expect(page.getByText(recovered.trackingNumber!, { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await stock()).toBe(initialStock - 1);
  await page.getByRole('button', { name: 'Close order details' }).click();

  const timeout = await create('TIMEOUT_AFTER_CREATE');
  await expect.poll(async () => (await read(timeout.order.id)).status, { timeout: 60_000, intervals: [1_000, 2_000] }).toBe('SHIPMENT_CREATED');
  const reconciled = await read(timeout.order.id);
  expect(reconciled.shipmentId).toBeTruthy();
  expect(reconciled.attemptGeneration).toBe(1);
  expect(reconciled.timeline.filter(event => event.type === 'ShipmentCreated')).toHaveLength(1);
  expect(await stock()).toBe(initialStock - 2);
  await page.getByRole('button', { name: 'Close order details' }).click();

  const normal = await create('NORMAL');
  await expect.poll(async () => (await read(normal.order.id)).status, { timeout: 60_000, intervals: [1_000, 2_000] }).toBe('SHIPMENT_CREATED');
  expect(await stock()).toBe(initialStock - 3);
});

async function fillOrder(page: Page, reference: string, sku: string, scenario: CreateOrder['demoScenario']) {
  await page.getByLabel('Customer reference').fill(reference);
  await page.getByLabel('Recipient').fill('Ada Lovelace');
  await page.getByLabel('Street address').fill('10 Example Street');
  await page.getByLabel('City').fill('London');
  await page.getByLabel('Postal code').fill('SW1A 1AA');
  await page.getByLabel('Country code').fill('GB');
  await page.getByRole('combobox', { name: 'Product 1', exact: true }).selectOption(sku);
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption(scenario);
}
