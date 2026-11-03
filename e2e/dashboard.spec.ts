import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const order = {
  id: 'order-001', customerReference: 'WEB-RECOVERY', status: 'FULFILLMENT_FAILED',
  createdAt: '2026-11-02T09:00:00Z', attemptGeneration: 1,
  shipmentId: null as string | null, trackingNumber: null as string | null,
  demoScenario: 'FAIL_THEN_RECOVER',
  shippingAddress: { recipient: 'Ada Lovelace', line1: '10 Example Street', city: 'London', postalCode: 'SW1A 1AA', country: 'GB' },
  items: [{ sku: 'COFFEE', quantity: 2 }],
  timeline: [{ id: 'event-1', type: 'FulfillmentFailed', message: 'Carrier unavailable after 3 attempts.', occurredAt: '2026-11-02T09:00:05Z' }],
};

async function setup(page: Page, role = 'OPERATOR') {
  let signedIn = false;
  const current = structuredClone(order);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/csrf') return route.fulfill({ json: { headerName: 'X-CSRF-TOKEN', token: 'test-csrf' } });
    if (url.pathname === '/api/session') return route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { username: role.toLowerCase(), role } : {} });
    if (url.pathname === '/api/inventory') return route.fulfill({ json: [{ sku: 'COFFEE', name: 'House blend coffee', availableQuantity: 24 }, { sku: 'MUG', name: 'Stoneware mug', availableQuantity: 8 }] });
    if (url.pathname.endsWith('/retry')) {
      current.status = 'SHIPMENT_CREATED'; current.shipmentId = 'shipment-001'; current.trackingNumber = 'TRACK-001'; current.attemptGeneration = 2;
      current.timeline.push({ id: 'event-2', type: 'ShipmentCreated', message: 'Carrier accepted shipment.', occurredAt: '2026-11-02T09:01:00Z' });
      return route.fulfill({ status: 202, json: current });
    }
    if (url.pathname === '/api/orders/order-001') return route.fulfill({ json: current });
    if (url.pathname === '/api/orders' && route.request().method() === 'GET') return route.fulfill({ json: { content: [current], number: Number(url.searchParams.get('page') ?? 0), size: 10, totalElements: 11, totalPages: 2 } });
    return route.fulfill({ status: 404, json: { detail: 'Not found' } });
  });
  await page.route('**/login', async route => { signedIn = true; return route.fulfill({ status: 204 }); });
  await page.route('**/logout', async route => { signedIn = false; return route.fulfill({ status: 204 }); });
  await page.goto('/');
  await page.getByLabel('Username').fill(role.toLowerCase());
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
}

test('operator inspects a failed order and recovers fulfillment', async ({ page }) => {
  await setup(page);
  await page.screenshot({ path: '.cache/overview-desktop.png' });
  await page.getByRole('button', { name: 'View order WEB-RECOVERY' }).click();
  const detail = page.getByRole('dialog', { name: 'Order WEB-RECOVERY' });
  await expect(detail.getByText('Carrier unavailable after 3 attempts.')).toBeVisible();
  await detail.getByRole('button', { name: 'Retry fulfillment' }).click();
  await expect(detail.getByText('TRACK-001')).toBeVisible();
  await expect(detail.getByText('Carrier accepted shipment.')).toBeVisible();
});

test('viewer can inspect orders and inventory but cannot mutate', async ({ page }) => {
  await setup(page, 'VIEWER');
  await expect(page.getByText('Read-only access')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New order', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View order WEB-RECOVERY' }).click();
  await expect(page.getByRole('button', { name: 'Retry fulfillment' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close order details' }).click();
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
  await expect(page.getByText('House blend coffee')).toBeVisible();
});

test('lost create response preserves exact request identity across refresh and safe retry', async ({ page }) => {
  await setup(page);
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route('**/api/orders/order-001', route => route.fulfill({ json: { ...order, customerReference: 'DRAFT-1', status: 'CONFIRMED' } }));
  await page.route('**/api/orders', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    requests.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
    if (requests.length === 1) return route.abort('failed');
    return route.fulfill({ status: 200, json: { ...order, customerReference: 'DRAFT-1', status: 'CONFIRMED' } });
  });
  await page.getByRole('button', { name: 'New order', exact: true }).click();
  await page.getByLabel('Customer reference').fill('DRAFT-1');
  await page.getByLabel('Recipient').fill('Ada Lovelace');
  await page.getByLabel('Street address').fill('10 Example Street');
  await page.getByLabel('City').fill('London');
  await page.getByLabel('Postal code').fill('SW1A 1AA');
  await page.getByLabel('Country code').fill('GB');
  await page.getByRole('combobox', { name: 'Product 1', exact: true }).selectOption('COFFEE');
  await page.getByRole('button', { name: 'Create order', exact: true }).click();
  await expect(page.getByText('Request outcome unknown')).toBeVisible();
  await expect(page.getByLabel('Customer reference')).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'New order', exact: true }).click();
  await expect(page.getByLabel('Customer reference')).toHaveValue('DRAFT-1');
  await page.getByRole('button', { name: 'Retry same request' }).click();
  await expect(page.getByRole('dialog', { name: 'Order DRAFT-1' })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
});

test('polling preserves an in-progress draft and pagination changes the requested page', async ({ page }) => {
  await setup(page);
  const next = page.waitForRequest(request => request.url().includes('page=1'));
  await page.getByRole('button', { name: 'Next page' }).click();
  await next;
  await page.getByRole('button', { name: 'New order', exact: true }).click();
  await page.getByLabel('Customer reference').fill('KEEP-MY-DRAFT');
  await page.waitForResponse(response => response.url().includes('/api/inventory'));
  await expect(page.getByLabel('Customer reference')).toHaveValue('KEEP-MY-DRAFT');
});

test('mobile navigation works without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
  await page.screenshot({ path: '.cache/inventory-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a failed refresh keeps existing orders visible and an empty result explains the next step', async ({ page }) => {
  await setup(page);
  await page.route('**/api/orders?*', route => route.fulfill({ status: 503, json: { detail: 'Order service unavailable.' } }));
  await page.getByRole('button', { name: 'Refresh orders' }).click();
  await expect(page.getByRole('alert')).toContainText('Updates paused. Order service unavailable.');
  await expect(page.getByRole('button', { name: 'View order WEB-RECOVERY' })).toBeVisible();
  await page.route('**/api/orders?*', route => route.fulfill({ json: { content: [], number: 0, size: 10, totalElements: 0, totalPages: 0 } }));
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A clean slate for your orders' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create your first order' })).toBeVisible();
});
