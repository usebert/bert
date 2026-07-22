import { expect, test } from "@playwright/test";

test("Risk Assessments navigation item appears between COSHH and Equipment", async ({ page }) => {
  await page.goto("/e2e/health-safety-nav.harness.html");
  const hsGroup = page.getByTestId("nav-group-health-&-safety");
  const items = hsGroup.locator("li");
  const ids = await items.allTextContents();
  const coshhIndex = ids.indexOf("healthSafetyCoshh");
  const riskIndex = ids.indexOf("riskAssessments");
  const equipmentIndex = ids.indexOf("loler");
  expect(coshhIndex).toBeGreaterThanOrEqual(0);
  expect(riskIndex).toBeGreaterThan(coshhIndex);
  expect(equipmentIndex).toBeGreaterThan(riskIndex);
});

test("Risk Assessments workspace loads list with summary tabs", async ({ page }) => {
  await page.goto("/e2e/risk-assessments.harness.html");
  await expect(page.getByRole("heading", { name: "Risk Assessments" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Active" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Drafts" })).toBeVisible();
  await expect(page.getByText("Warehouse manual handling")).toBeVisible();
});

test("Risk Assessments detail opens from list", async ({ page }) => {
  await page.goto("/e2e/risk-assessments.harness.html");
  await page.getByRole("button", { name: "Warehouse manual handling" }).click();
  await expect(page.getByText("RA-0001")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Warehouse manual handling" })).toBeVisible();
});

test("Risk score band is shown on detail hazard", async ({ page }) => {
  await page.goto("/e2e/risk-assessments.harness.html");
  await page.getByRole("button", { name: "Warehouse manual handling" }).click();
  await expect(page.getByText("9 Moderate").first()).toBeVisible();
});

test("Create assessment opens wizard", async ({ page }) => {
  await page.goto("/e2e/risk-assessments.harness.html");
  await page.getByRole("button", { name: "Create assessment" }).click();
  await expect(page.getByText(/Step 1 of 7: Details/)).toBeVisible();
});

test("Mobile layout keeps primary actions reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/risk-assessments.harness.html");
  await expect(page.getByRole("button", { name: "Create assessment" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Risk Assessments" })).toBeVisible();
});
