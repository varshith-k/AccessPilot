# Browser automation: steps 1 and 2

This module runs in the Node.js backend only. It provides session management and a
proposed shared contract for Persons 3, 4 and 5. Team review is still needed; this
does not imply the Twinly or orchestrator owners have approved the contract.

## Setup and verification

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

## Session lifecycle

```ts
import { createBrowserSession } from "@/lib/browser/session";

const session = await createBrowserSession({ headless: false });
try {
  // Trusted local demo URL only until navigation restrictions are implemented.
  await session.page.goto("http://localhost:4000/scholarship");
  console.log(await session.page.title());
} finally {
  await session.close();
}
```

Create one session per task and retain it across actions. The same page, cookies,
and storage survive until close. Sessions are isolated from each other and from
the user's normal browser profile. Nothing is persisted between sessions or
process restarts. Defaults: headless Chromium, 1280 x 720 CSS pixels, device scale
factor 1, 10-second action timeout, 30-second navigation and launch timeouts.
Repeated close calls share cleanup. Use `channel: "chrome"` for installed Chrome.

## Proposed internal action contract

Import `browserActionSchema`, `BrowserAction`, `ActionResult`, and
`ExecuteActionOptions` from `lib/contracts`. Validate incoming actions before
execution. The schema validates structure only; URL policy, bounds checks,
supported keys and approval enforcement belong to the future executor.

Every action has `id` (unique per proposal), `commits` (explicit boolean), and
optional `label` and `reason`. Changing any proposed action requires a new id.

| Type                    | Fields             | Meaning                                 |
| ----------------------- | ------------------ | --------------------------------------- |
| `click`, `double_click` | `x`, `y`           | Viewport CSS pixels, origin at top left |
| `type`                  | `text`             | Type into the focused field             |
| `key`                   | `key`              | Playwright keyboard name or chord       |
| `scroll`                | `deltaX`, `deltaY` | Signed CSS pixel wheel deltas           |
| `navigate`              | `url`              | Destination subject to URL policy       |
| `wait`                  | `durationMs`       | Bounded delay, at most 10 seconds       |

Person 3 normalizes Twinly coordinates into the screenshot viewport, returns
these proposals, and handles model completion/failure separately. Never execute
`done` or `fail` as browser interactions. Screenshots must use viewport capture
and CSS scale, with the viewport dimensions attached. The executor must reject
out-of-bounds coordinates and stale observations rather than clamp them.

Person 5 supplies `AbortSignal` and trusted approval `{ approvalId, actionId }`
through `ExecuteActionOptions`. The future executor must match these against the
pending approval, consume approval once, and never trust approval from AI output.
`commits: false` cannot override a browser-side submission safety check.

Results carry `actionId`, optional screenshot and page context, and one status:
`executed`, `approval_required`, `cancelled`, or `failed`. `executed` additionally
reports `verification`: `unverified`, `passed`, or `failed`. Executing an action
does not prove that the user's task succeeded. Error messages must omit secrets.
Page context excludes sensitive values.

## Remaining steps

The executor, screenshot helper, DOM extraction, URL restrictions, approval gate,
and active-action cancellation are not implemented yet. Do not connect untrusted
URLs or model actions to raw `session.page` access. Step 3 adds navigation policy;
later steps implement `ExecuteBrowserAction` and the remaining controls.
