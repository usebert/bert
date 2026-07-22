import { expect, test } from "@playwright/test";

test("RIDDOR assessment panel shows disclaimer and records likely reportable decision", async ({ page }) => {
  await page.goto("/e2e/riddor-assessment.harness.html");
  await page.evaluate(() => window.__riddorHarness?.reset());

  await expect(page.getByText(/does not replace competent legal/i)).toBeVisible();

  await page.getByLabel(/specified injury/i).check();
  await page.getByRole("button", { name: /save assessment/i }).click();

  await expect.poll(async () => page.evaluate(() => Boolean(window.__riddorHarness?.completed))).toBe(true);
});
