import { expect, test } from "@playwright/test";
import { expectNoSeriousViolations, fillAndStart, openScenario, statusLine } from "./helpers";

test.describe("axe: no serious or critical violations", () => {
  test("idle, including the first-run speech question", async ({ page }) => {
    await openScenario(page, "scholarship-happy", { firstRun: true });
    await expect(
      page.getByRole("heading", { name: "Do you use your own screen reader?" }),
    ).toBeVisible();
    await expectNoSeriousViolations(page, "idle");
  });

  test("running", async ({ page }) => {
    await openScenario(page, "slow-network");
    await fillAndStart(page);
    await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Progress" })).toBeVisible();
    await expectNoSeriousViolations(page, "running");
  });

  test("approval and completed", async ({ page }) => {
    await openScenario(page, "scholarship-happy");
    await fillAndStart(page);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSeriousViolations(page, "approval");

    await page.getByRole("button", { name: "Approve and submit" }).click();
    await expect(statusLine(page)).toHaveText("Submitted. Confirmation number 4821.");
    await expectNoSeriousViolations(page, "completed");
  });

  test("hand-off", async ({ page }) => {
    await openScenario(page, "password-handoff");
    await fillAndStart(page);
    await expect(page.getByRole("heading", { name: "Your turn" })).toBeFocused();
    await expectNoSeriousViolations(page, "hand-off");
  });

  test("failure", async ({ page }) => {
    await openScenario(page, "failure");
    await fillAndStart(page);
    await expect(page.getByRole("heading", { name: /The task didn't finish/ })).toBeVisible();
    await expectNoSeriousViolations(page, "failure");
  });

  test("dark mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openScenario(page, "scholarship-happy");
    await fillAndStart(page);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSeriousViolations(page, "dark mode approval");
  });
});
