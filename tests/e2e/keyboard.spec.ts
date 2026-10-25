import { expect, test } from "@playwright/test";
import { focusedInDialog, openScenario, statusLine } from "./helpers";

test("completes the scholarship happy path using only the keyboard", async ({ page }) => {
  await openScenario(page, "scholarship-happy");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  const url = page.getByLabel("Website address");
  for (let i = 0; i < 10 && !(await url.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(url).toBeFocused();
  await page.keyboard.type("http://localhost:4000/scholarship");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("What do you want to get done?")).toBeFocused();
  await page.keyboard.type("Help me complete this scholarship application.");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Start task" })).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { level: 2 })).toBeFocused();
  await expect(page).toHaveTitle("Waiting for your approval — AccessPilot");

  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Don't submit" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Approve and submit" })).toBeFocused();
  expect((await focusedInDialog(page)).inside).toBe(true);
  await page.keyboard.press("Enter");

  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Status" })).toBeFocused();
  await expect(statusLine(page)).toHaveText("Submitted. Confirmation number 4821.");
  await expect(page).toHaveTitle("Done — AccessPilot");
});

test("Alt+Shift+S stops the task from inside a text field", async ({ page }) => {
  await openScenario(page, "slow-network");
  await page.getByLabel("Website address").fill("https://example.edu");
  await page.getByLabel("What do you want to get done?").fill("Find the deadline");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible();

  // Any text field counts; the task form itself steps aside while a task runs.
  await page.evaluate(() => {
    const field = document.body.appendChild(document.createElement("input"));
    field.setAttribute("aria-label", "Scratch field");
    field.focus();
  });
  await page.keyboard.type("abc");
  await page.keyboard.press("Alt+Shift+S");
  await expect(page.getByLabel("Scratch field")).toHaveValue("abc");
  await expect(statusLine(page)).toHaveText(/^Stopped\./);
  await expect(page).toHaveTitle("Stopped — AccessPilot");
});

test("? opens the keyboard shortcuts list and Escape closes it", async ({ page }) => {
  await openScenario(page, "scholarship-happy");
  await page.getByRole("button", { name: "Start task" }).focus();
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await expect(help.getByRole("heading", { name: "Keyboard shortcuts" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(page.getByRole("button", { name: "Start task" })).toBeFocused();
});
