import { expect, test } from "@playwright/test";

test("company switcher opens beneath pill, stays visible, and switches workspace", async ({ page }) => {
  await page.goto("/e2e/company-switcher.harness.html");
  await page.evaluate(() => window.__companySwitcherHarness?.reset());

  const trigger = page.getByTestId("company-switcher-trigger");
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click();
  const menu = page.getByTestId("company-switcher-panel");
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("option", { name: /Dovecote Manufacturing Ltd/ })).toHaveAttribute("aria-selected", "true");
  await expect(menu.getByRole("option", { name: /Midlands Precast Ltd/ })).toBeVisible();

  const triggerBox = await trigger.boundingBox();
  const menuBox = await menu.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  if (triggerBox && menuBox) {
    expect(menuBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height - 1);
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.y).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(1280 + 1);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(720 + 1);
  }

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();

  await menu.getByRole("option", { name: /Midlands Precast Ltd/ }).click();
  await expect(menu).toBeHidden();
  await expect.poll(async () => page.evaluate(() => window.__companySwitcherHarness?.selectCalls ?? [])).toEqual([
    "company-b",
  ]);
  await expect.poll(async () => page.evaluate(() => window.__companySwitcherHarness?.selectedId ?? "")).toBe("company-b");
});

test("single-workspace users do not see the switcher trigger on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/e2e/company-switcher.harness.html");
  await expect(page.getByTestId("company-switcher-trigger")).toHaveCount(1);
});
