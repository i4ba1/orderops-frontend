import { defineConfig, devices } from '@playwright/test';

const realStack = process.env.ORDEROPS_E2E_URL;
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'ui', testMatch: /dashboard\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:4173' } },
    { name: 'real-stack', testMatch: /real-stack\.spec\.ts/, use: { baseURL: realStack ?? 'http://127.0.0.1:8088' } },
  ],
  webServer: !realStack ? { command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false } : undefined,
});
