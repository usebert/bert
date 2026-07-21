import { expect, test } from "@playwright/test";

test("account menu opens, stays visible, and signs out", async ({ page }) => {
  await page.goto("/e2e/account-menu.harness.html");
  await page.evaluate(() => window.__accountMenuHarness?.reset());

  const trigger = page.getByTestId("account-menu-trigger");
  await expect(trigger).toBeVisible();

  await trigger.click();

  const menu = page.getByTestId("account-menu-panel");
  await expect(menu).toBeVisible();
  await expect(menu.getByText("Test User")).toBeVisible();
  await expect(menu.getByText("Admin")).toBeVisible();
  await expect(menu.getByText("Acme Manufacturing Ltd")).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Account" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Switch company" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Help" })).toBeVisible();

  const signOut = page.getByTestId("account-menu-sign-out");
  await expect(signOut).toBeVisible();

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  if (box && viewport) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  }

  await expect(menu).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await trigger.click();
  await expect(menu).toBeVisible();

  await signOut.click();
  await expect(menu).toBeHidden();
  await expect.poll(async () => page.evaluate(() => Boolean(window.__accountMenuHarness?.logoutInvoked))).toBe(true);
});
