import { expect, test } from "@playwright/test";

test("Health & Safety nav group contains Incidents and Equipment without Compliance duplicates", async ({ page }) => {
  await page.goto("/e2e/health-safety-nav.harness.html");

  const hsGroup = page.getByTestId("nav-group-health-&-safety");
  await expect(hsGroup).toBeVisible();
  await expect(hsGroup.getByTestId("nav-item-healthSafety")).toBeVisible();
  await expect(hsGroup.getByTestId("nav-item-incidents")).toBeVisible();
  await expect(hsGroup.getByTestId("nav-item-healthSafetyRiddor")).toBeVisible();
  await expect(hsGroup.getByTestId("nav-item-healthSafetyCoshh")).toBeVisible();
  await expect(hsGroup.getByTestId("nav-item-loler")).toHaveText("loler");

  const complianceGroup = page.getByTestId("nav-group-compliance");
  await expect(complianceGroup).toBeVisible();
  await expect(complianceGroup.getByTestId("nav-item-incidents")).toHaveCount(0);
  await expect(complianceGroup.getByTestId("nav-item-loler")).toHaveCount(0);
});
