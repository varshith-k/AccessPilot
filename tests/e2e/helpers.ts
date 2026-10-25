import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export type Scenario =
  "scholarship-happy" | "scholarship-deny" | "password-handoff" | "failure" | "slow-network";

/** Opens the app on a mock scenario played 20x faster, with the first-run question answered. */
export async function openScenario(page: Page, scenario: Scenario, { firstRun = false } = {}) {
  if (!firstRun) {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "accesspilot.settings.v1",
        JSON.stringify({ firstRunDone: true, readAloud: false }),
      );
    });
  }
  await page.goto(`/?mock=${scenario}&mockSpeed=0.05`);
  await expect(page.getByRole("heading", { level: 1, name: "AccessPilot" })).toBeVisible();
  // The microphone button only renders once React has hydrated, so shortcuts and handlers work.
  await expect(page.getByRole("button", { name: /^Microphone/ })).toBeVisible();
}

export async function fillAndStart(page: Page) {
  await page.getByLabel("Website address").fill("http://localhost:4000/scholarship");
  await page
    .getByLabel("What do you want to get done?")
    .fill("Help me complete this scholarship application.");
  await page.getByRole("button", { name: "Start task" }).click();
}

export function statusLine(page: Page) {
  return page.locator("p.text-lg").first();
}

/** Fails on any serious or critical axe violation, listing them for debugging. */
export async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
  expect(blocking, `axe violations at ${label}`).toEqual([]);
}

/** True when the page scrolls sideways at the current viewport. */
export async function hasHorizontalScroll(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

/** Describes the focused element, for focus assertions. */
export async function focusedInDialog(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    const dialog = document.querySelector("dialog[open]");
    return {
      inside: Boolean(active && dialog?.contains(active)),
      onBody: active === document.body || active === null,
      text: active?.textContent?.trim() ?? "",
    };
  });
}
