import { expect, test } from "@playwright/test";

test("Health & Safety overview loads manager command centre sections", async ({ page }) => {
  await page.goto("/e2e/health-safety-overview.harness.html");
  await page.evaluate(() => window.__healthSafetyOverviewHarness?.reset());

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Your current safety position across incidents, COSHH, RIDDOR and equipment.")).toBeVisible();
  await expect(page.getByText("Attention required")).toBeVisible();
  await expect(page.getByText("Requires attention")).toBeVisible();
  await expect(page.getByText("Module health")).toBeVisible();
  await expect(page.getByText("Recent activity")).toBeVisible();
  await expect(page.getByText("Quick actions")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();
  await expect(page.getByText("Equipment inspections overdue", { exact: false })).toHaveCount(0);
});

test("Requires attention action navigates to the correct workspace", async ({ page }) => {
  await page.goto("/e2e/health-safety-overview.harness.html");
  await page.evaluate(() => window.__healthSafetyOverviewHarness?.reset());

  await page.getByRole("button", { name: "Complete RIDDOR decision" }).click();
  await expect
    .poll(async () => page.evaluate(() => window.__healthSafetyOverviewHarness?.lastNavigate?.screen))
    .toBe("healthSafetyRiddor");
});

test("Empty attention state renders positive empty state", async ({ page }) => {
  await page.goto("/e2e/health-safety-overview.harness.html");
  await page.evaluate(() => {
    window.__healthSafetyOverviewHarness?.setMode("empty");
  });

  await expect(page.getByText("Great news")).toBeVisible();
  await expect(page.getByText("No urgent Health & Safety issues need attention right now.")).toBeVisible();
});

test("Refresh keeps content visible and records another overview request", async ({ page }) => {
  await page.goto("/e2e/health-safety-overview.harness.html");
  await page.evaluate(() => window.__healthSafetyOverviewHarness?.reset());

  await expect(page.getByText("Attention required")).toBeVisible();
  const before = await page.evaluate(() => window.__healthSafetyOverviewHarness?.refreshCount || 0);
  await page.getByRole("button", { name: "Refresh Health and Safety overview" }).click();
  await expect(page.getByText("Attention required")).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => window.__healthSafetyOverviewHarness?.refreshCount || 0))
    .toBeGreaterThan(before);
});

test("Quick actions are visible for Admin role", async ({ page }) => {
  await page.goto("/e2e/health-safety-overview.harness.html");
  await page.evaluate(() => window.__healthSafetyOverviewHarness?.reset());

  await expect(page.getByRole("button", { name: "Report incident" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add chemical" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add equipment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open RIDDOR workspace" })).toBeVisible();
});

test("Tablet layout keeps primary sections stacked and readable", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/e2e/health-safety-overview.harness.html");
  await page.evaluate(() => window.__healthSafetyOverviewHarness?.reset());

  const attention = page.getByText("Requires attention");
  const modules = page.getByText("Module health");
  await expect(attention).toBeVisible();
  await expect(modules).toBeVisible();
  const attentionBox = await attention.boundingBox();
  const modulesBox = await modules.boundingBox();
  expect(attentionBox && modulesBox && attentionBox.y < modulesBox.y).toBeTruthy();
});
