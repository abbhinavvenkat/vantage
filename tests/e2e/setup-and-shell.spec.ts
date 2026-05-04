import { expect, test } from '@playwright/test';

// E2E shell test: this exercises the front-end skeleton end-to-end.
// It depends on the (auth) flow which is owned by the auth agent. Until that
// lands, this spec is gated by the SHELL_E2E env flag so CI doesn't fail.

test.skip(!process.env.SHELL_E2E, 'Set SHELL_E2E=1 to run after auth + db agents land');

test('user completes setup, creates portfolio, sees holdings placeholder', async ({ page }) => {
  await page.goto('/');
  // Unauthenticated → /setup
  await expect(page).toHaveURL(/\/setup$/);
  await page.fill('input[name="password"]', 'test_password_123!');
  await page.fill('input[name="confirmPassword"]', 'test_password_123!');
  await page.click('button[type="submit"]');

  // After setup → /portfolios
  await expect(page).toHaveURL(/\/portfolios$/);

  // Create a portfolio
  await page.fill('input[name="name"]', 'Main');
  await page.click('button:has-text("Create")');

  // Switch to /p/<id>/holdings via header switcher / nav
  await expect(page.getByRole('link', { name: /Holdings/i })).toBeVisible();
  await page.getByRole('link', { name: /Holdings/i }).click();

  await expect(page).toHaveURL(/\/p\/[^/]+\/holdings$/);
  await expect(page.getByText(/Holdings/i)).toBeVisible();
  await expect(page.getByText(/coming once parser\/analytics agents land/i)).toBeVisible();
});
