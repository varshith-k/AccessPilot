import { expect, test } from "@playwright/test";
import { fillAndStart, focusedInDialog, openScenario, statusLine } from "./helpers";

test.describe("approval dialog", () => {
  test.beforeEach(async ({ page }) => {
    await openScenario(page, "scholarship-deny");
    await fillAndStart(page);
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("contains focus: Tab and Shift+Tab never reach the page behind it", async ({ page }) => {
    await expect(page.getByRole("dialog").getByRole("heading", { level: 2 })).toBeFocused();
    for (const key of ["Tab", "Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      const focus = await focusedInDialog(page);
      // Chrome may briefly move focus to its own toolbar (body), never to page content.
      expect(focus.inside || focus.onBody, `focus after ${key}: ${focus.text}`).toBe(true);
    }
  });

  test("Escape denies, never approves, and restores focus to the status area", async ({ page }) => {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Status" })).toBeFocused();
    await expect(statusLine(page)).toHaveText(/^Not submitted\./);
    await expect(
      page.getByRole("listitem").filter({ hasText: "Declined: Submit application" }),
    ).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Approved:" })).toHaveCount(0);
  });

  test("no button is focused by default and nothing approves on its own", async ({ page }) => {
    const focus = await focusedInDialog(page);
    expect(focus.text).toMatch(/^Approval needed/);
    await page.waitForTimeout(3000);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveTitle("Waiting for your approval — AccessPilot");
  });
});
