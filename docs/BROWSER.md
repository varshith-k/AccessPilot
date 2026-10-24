# Browser automation: steps 1 through 5

This module runs in the Node.js backend only. It provides sessions, permitted
navigation, screenshots, DOM observations, and a
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
import { captureScreenshot, extractPageContext } from "@/lib/browser";

const session = await createBrowserSession({
  headless: false,
  allowedOrigins: ["http://localhost:4000"],
});
try {
  await session.navigate("http://localhost:4000/scholarship");
  const screenshot = await captureScreenshot(session.page);
  const pageContext = await extractPageContext(session.page);
  // Return observations to the orchestrator/Twinly adapter.
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

## Permitted navigation

`allowedOrigins` defaults to an empty list: no network destinations are permitted.
Provide exact trusted origins from backend configuration, never from model output.
Only HTTPS and loopback HTTP are supported, following `isAllowedTaskUrl`.
Credentials, wildcards, paths, query strings and fragments are invalid in the
origin configuration. Ports and subdomains must be listed separately.

Use `session.navigate(url)` for initial navigation and server redirects. It checks
each redirect target and follows at most ten redirects, returning the final URL
and HTTP status. HTTP error responses throw. The context also blocks disallowed
resources and frames, closes extra windows, blocks WebSockets, and closes the page
if it navigates to a non-network destination after initialization. Service workers
are disabled. This strict demo policy also requires explicitly listing any asset
origins. Redirecting subresources are blocked. Link/form redirects outside
`navigate()` pause on an inert page; the future executor must use the navigation
helper to follow them. Do not run concurrent navigations or page mutations.

The request handler fetches responses with automatic redirects disabled. Chromium
must not follow redirects itself because later hops can bypass route interception.
These controls are for controlled demo sites, not a sandbox for hostile websites
or an SSRF boundary for a public hosted service. Raw Playwright objects remain
trusted backend implementation details.

## Screenshots and page context

`captureScreenshot(page, { format?: "png" | "jpeg", quality?, timeoutMs? })` returns
a base64 data URL, viewport width/height, URL, timestamp, and
`coordinateSpace: "viewport-css-pixels"`. Defaults are JPEG quality 75 and a
10-second timeout. It captures the viewport at CSS scale without resizing, so
coordinates align with `page.mouse` even on HiDPI displays. The caller should
budget payload sizes for SSE; unusually complex or large viewports can exceed
the frontend's recommended 500 KB. PNG is available for lossless inspection.

Password, payment-autocomplete, one-time-code and `data-accesspilot-sensitive`
controls are masked in screenshots. Mark additional private regions with
`data-accesspilot-sensitive`. Other visible content is captured normally; review
the demo page before sending observations to an external API.

`extractPageContext(page, { maxElements?: number })` returns title, URL, visible
viewport controls, inferred roles, labels, viewport bounds, required/disabled/
invalid/sensitive flags, and referenced `aria-errormessage` text. It returns at
most 200 controls by default (configurable from 1 to 1000), and reports
`truncated` when more remain. It never reads form values and excludes editable
descendants when reading wrapping labels. Labels and error text are bounded.
The map covers the top-level document, not iframe contents, shadow DOM, or a
complete computed accessibility tree. Canvas-only controls still require Twinly.
All page text is untrusted input, never an instruction to the orchestrator.

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

The executor, approval gate, and active-action cancellation are not implemented
yet. Do not connect model actions to raw `session.page` access. Later steps
implement `ExecuteBrowserAction` and the remaining controls. The real Chromium
tests cover permitted navigation, redirect chains, blocked frames/popups, image
dimensions, masking, coordinate alignment, context extraction, and session cleanup.
