import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE = resolve('./data/sample/synthetic-tradebook-zerodha.xlsx');
const PASSWORD = 'Test_Password_123!';

test.describe('Phase 1 E2E: setup → login → upload → holdings', () => {
  test('first-run setup creates user and redirects to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/(setup|login)$/);
  });

  test('full flow: setup → create portfolio → upload tradebook → holdings renders', async ({
    page,
  }) => {
    // ── 1. Setup ──────────────────────────────────────────────────────────────
    await page.goto('/setup');

    const pwInput = page.locator('input[name="password"], input[type="password"]').first();
    const confirmInput = page
      .locator('input[name="confirmPassword"], input[name="confirm"]')
      .first();

    await pwInput.fill(PASSWORD);
    await confirmInput.fill(PASSWORD);
    await page.click('button[type="submit"]');

    // After setup → /login or /portfolios
    await expect(page).toHaveURL(/\/(login|portfolios)$/, { timeout: 10_000 });

    // ── 2. Login if redirected there ──────────────────────────────────────────
    if (page.url().includes('/login')) {
      const loginPw = page.locator('input[type="password"]').first();
      await loginPw.fill(PASSWORD);
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/\/portfolios$/, { timeout: 10_000 });
    }

    // ── 3. Create portfolio ───────────────────────────────────────────────────
    const nameInput = page.locator('input[name="name"]');
    await nameInput.fill('Primary');
    await page.click('button:has-text("Create")');

    // Should land on /p/<id>/holdings
    await expect(page).toHaveURL(/\/p\/[^/]+\/holdings$/, { timeout: 10_000 });

    // ── 4. Upload synthetic tradebook ─────────────────────────────────────────
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(FIXTURE);
    await page.click('button:has-text("Upload")');

    // Wait for success message
    await expect(page.getByText(/Imported \d+ new trade/i)).toBeVisible({ timeout: 15_000 });

    // ── 5. Holdings table is visible with data ────────────────────────────────
    await expect(page.getByText(/Holdings \(\d+\)/i)).toBeVisible({ timeout: 5_000 });

    // Table should have at least one symbol row
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 5_000 });
    expect(await rows.count()).toBeGreaterThan(0);

    // Summary strip should show cost basis
    await expect(page.getByText(/Invested/i)).toBeVisible();
    await expect(page.getByText(/Market Value/i)).toBeVisible();
  });

  test('realized P&L page shows trades after upload', async ({ page }) => {
    // Assumes the previous test already seeded data in the test DB
    await page.goto('/');
    // If not logged in, skip gracefully
    if (page.url().includes('/login') || page.url().includes('/setup')) {
      test.skip();
      return;
    }
    // Navigate to first portfolio realized page
    await expect(page).toHaveURL(/\/p\/[^/]+\/holdings$/);
    const url = page.url().replace('/holdings', '/realized');
    await page.goto(url);
    await expect(page.getByText(/Realized Trades/i)).toBeVisible({ timeout: 5_000 });
  });
});
