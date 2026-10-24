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
