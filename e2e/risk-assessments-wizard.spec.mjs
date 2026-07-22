import { expect, test } from "@playwright/test";

test("Wizard hazard flow: add, review once, edit, save draft, no duplicates", async ({ page }) => {
  await page.goto("/e2e/risk-assessments.harness.html");
  await page.getByRole("button", { name: "Create assessment" }).click();
  await page.getByLabel("Title").fill("Slips assessment");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Hazard title").fill("Warehouse aisle slip");
  await page.getByRole("button", { name: "Add hazard" }).click();
  await expect(page.getByTestId(/^wizard-hazard-/)).toHaveCount(1);

  for (let step = 0; step < 4; step += 1) {
    await page.getByRole("button", { name: "Next" }).click();
  }

  await expect(page.getByText("1 hazard(s) recorded.")).toBeVisible();
  await expect(page.getByTestId(/^wizard-hazard-/)).toHaveCount(1);

  await page.getByRole("button", { name: "Edit hazard" }).click();
  await page.getByLabel("Who might be harmed").fill("Employees and visitors");
  await page.getByRole("button", { name: "Save changes" }).click();

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await expect(page.getByTestId(/^wizard-hazard-/)).toHaveCount(1);

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await expect(page.getByTestId(/^wizard-hazard-/)).toHaveCount(1);
});

test("Two hazards with same title but different IDs both remain visible", async ({ page }) => {
  await page.goto("/e2e/risk-assessments.harness.html");
  await page.getByRole("button", { name: "Create assessment" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Hazard title").fill("Shared title hazard");
  await page.getByRole("button", { name: "Add hazard" }).click();
  await page.getByLabel("Hazard title").fill("Shared title hazard");
  await page.getByRole("button", { name: "Add hazard" }).click();

  await expect(page.getByTestId(/^wizard-hazard-/)).toHaveCount(2);
});

test("Validation link opens hazard edit on the correct step", async ({ page }) => {
  await page.goto("/e2e/risk-assessments.harness.html");
  await page.getByRole("button", { name: "Create assessment" }).click();
  await page.getByLabel("Title").fill("Validation test");
  await page.getByLabel("Assessment date").fill("2026-07-01");
  await page.getByLabel("Review date").fill("2027-07-01");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Hazard title").fill("Warehouse aisle slip");
  await page.getByRole("button", { name: "Add hazard" }).click();

  for (let step = 0; step < 4; step += 1) {
    await page.getByRole("button", { name: "Next" }).click();
  }

  await expect(page.getByRole("button", { name: "Submit for approval" })).toBeDisabled();
  await page.getByRole("button", { name: /Who might be harmed is required/ }).click();
  await expect(page.getByText("Editing hazard")).toBeVisible();
  await expect(page.getByLabel("Who might be harmed")).toBeFocused();
});
