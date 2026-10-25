import { expect, test } from "@playwright/test";
import { fillAndStart, hasHorizontalScroll, openScenario } from "./helpers";

// A 1280x800 window at 200% zoom has a 640x400 CSS viewport; at 400% it is 320x200.
const viewports = [
  { name: "320px wide", width: 320, height: 640 },
  { name: "200% zoom", width: 640, height: 400 },
  { name: "400% zoom", width: 320, height: 200 },
];

for (const viewport of viewports) {
  test(`no horizontal scroll at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openScenario(page, "scholarship-happy", { firstRun: true });
    expect(await hasHorizontalScroll(page), "idle").toBe(false);

    await page.getByRole("button", { name: "Read aloud for me" }).click();
    await fillAndStart(page);
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await hasHorizontalScroll(page), "approval").toBe(false);
    const box = await page.getByRole("dialog").boundingBox();
    expect(box !== null && box.x >= 0 && box.x + box.width <= viewport.width).toBe(true);

    await page.getByRole("button", { name: "Approve and submit" }).click();
    await expect(page.getByRole("button", { name: "Start a new task" })).toBeVisible();
    expect(await hasHorizontalScroll(page), "completed").toBe(false);
  });
}

test("text resized to 200% still fits without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openScenario(page, "scholarship-happy");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  expect(await hasHorizontalScroll(page)).toBe(false);
  await expect(page.getByRole("button", { name: "Start task" })).toBeVisible();
});

test("phone: approving from the Browser tab returns to the conversation and focuses Status", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openScenario(page, "scholarship-happy", { speed: 0.3 });
  await fillAndStart(page);
  await page.getByRole("button", { name: /^Browser/ }).click();
  await expect(page.getByRole("button", { name: /^Browser/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Approve and submit" }).click();

  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Conversation" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Status" })).toBeFocused();
});

test("320x640: both approval answers are visible without scrolling the dialog", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openScenario(page, "scholarship-happy");
  await fillAndStart(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (const name of ["Don't submit", "Approve and submit"]) {
    const box = await dialog.getByRole("button", { name }).boundingBox();
    expect(box, name).not.toBeNull();
    expect(box!.y + box!.height, name).toBeLessThanOrEqual(640);
    expect(box!.y, name).toBeGreaterThanOrEqual(0);
  }
  // The details are still reachable by scrolling, and the buttons stay in view while they are.
  await dialog.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect(dialog.getByText("Essay")).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Approve and submit" })).toBeInViewport();
});
