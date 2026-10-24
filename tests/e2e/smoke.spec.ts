import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page loads with a heading and no serious axe violations", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/AccessPilot/);
  await expect(page.getByRole("heading", { level: 1, name: "AccessPilot" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(blocking).toEqual([]);
});
