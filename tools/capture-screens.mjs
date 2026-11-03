// Captures representative screenshots against the running stack for the frontend README.
// Run: ORDEROPS_SCREENSHOT_URL=http://127.0.0.1:8088 node tools/capture-screens.mjs
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.ORDEROPS_SCREENSHOT_URL;
if (!base) throw new Error('Set ORDEROPS_SCREENSHOT_URL to the running web endpoint.');
const out = resolve(process.env.ORDEROPS_SCREENSHOT_OUTPUT ?? 'docs/screenshots');
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const desktop = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
const page = await desktop.newPage();

async function shot(name, opts = {}) {
  await page.screenshot({ path: resolve(out, name), fullPage: !!opts.fullPage });
  console.log('saved', name);
}

try {
  await page.goto('/');
  await page.waitForSelector('form');
  await shot('login.png');

  await page.getByLabel('Username').fill('operator');
  await page.getByLabel('Password').fill('operator-local-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Operations overview' }).waitFor();
  await page.waitForTimeout(600);
  await shot('overview-desktop.png');

  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  await page.getByRole('heading', { name: 'Inventory', exact: true }).waitFor();
  await page.waitForTimeout(400);
  await shot('inventory.png');

  await page.getByRole('button', { name: /Orders/ }).click();
  await page.getByRole('heading', { name: 'Orders', exact: true }).waitFor();
  await page.waitForTimeout(600);
  await shot('orders.png');

  await page.getByRole('button', { name: 'New order', exact: true }).click();
  await page.getByRole('dialog', { name: 'New order' }).waitFor();
  await page.waitForTimeout(300);
  await shot('create-order.png');

  await page.getByRole('button', { name: 'Close new order' }).click();

  const orders = await page.locator('tbody tr').count();
  if (orders > 0) {
    await page.locator('tbody tr').first().getByRole('button', { name: /View order/ }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(600);
    await shot('order-detail.png');
    await page.getByRole('button', { name: /Close order details/ }).click();
  }

  await desktop.close();

  const mobile = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 844 } });
  const mpage = await mobile.newPage();
  await mpage.goto('/');
  await mpage.getByLabel('Username').fill('operator');
  await mpage.getByLabel('Password').fill('operator-local-only');
  await mpage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await mpage.getByRole('heading', { name: 'Operations overview' }).waitFor();
  await mpage.waitForTimeout(600);
  await mpage.screenshot({ path: resolve(out, 'overview-mobile.png') });
  console.log('saved overview-mobile.png');
  await mobile.close();
} finally {
  await browser.close();
}
console.log('done ->', out);
