import { defineConfig, devices } from '@playwright/test';

const TEST_DB = 'file:./data/test.db';
const SESSION_PW = 'test_session_password_at_least_32_characters_long_xx';
const TEST_PORT = 3002;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Reset test.db + run migrations BEFORE starting dev server. This must
    // happen before `next dev` so the server's DB connection sees the schema.
    // Playwright starts webServer before globalSetup, so we can't rely on globalSetup here.
    command: `rm -f ./data/test.db ./data/test.db-wal ./data/test.db-shm && npm run db:migrate && npm run dev -- -p ${TEST_PORT}`,
    url: `http://localhost:${TEST_PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DB,
      SESSION_PASSWORD: SESSION_PW,
    },
  },
});
