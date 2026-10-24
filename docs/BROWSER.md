# Browser automation: steps 1 through 10

This module runs in the Node.js backend only. It provides sessions, permitted
navigation, screenshots, DOM observations, action execution, and a
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
origins. Redirecting subresources are blocked. The controller follows allowed
link/form redirects through the same navigation policy. Raw session callers must
call `followPendingRedirect()` after a redirecting interaction. Do not run
concurrent raw navigations or page mutations.
Method-preserving 307/308 redirects after non-GET/HEAD requests are blocked rather
than replaying a potentially consequential request.

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
execution. The schema validates structure; the controller additionally enforces
URL policy, coordinate bounds, supported keys, stale observations and approval.

Every action has `id` (unique per proposal), `commits` (explicit boolean), and
optional `label` and `reason`. Changing any proposed action requires a new id.
Coordinate clicks also require `observationId` from the latest observation.

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
and CSS scale, with the viewport dimensions attached. The executor rejects
out-of-bounds coordinates and stale observations rather than clamping them.

Person 5 supplies `AbortSignal` and trusted approval `{ approvalId, actionId }`
through `ExecuteActionOptions`. The executor matches these against the
pending approval, consumes approval once, and never trusts approval from AI output.
`commits: false` cannot override a browser-side submission safety check.

Results carry `actionId`, optional screenshot and page context, and one status:
`executed`, `approval_required`, `user_input_required`, `cancelled`, or `failed`. `executed` additionally
reports `verification`: `unverified`, `passed`, or `failed`. Executing an action
does not prove that the user's task succeeded. Error messages must omit secrets.
Page context excludes sensitive values.

## Controller API for Persons 3 and 5

Use `createBrowserController()` rather than a raw session for agent execution:

```ts
import { createBrowserController } from "@/lib/browser";

const controller = await createBrowserController({
  allowedOrigins: ["http://localhost:4000"],
  headless: false,
});
try {
  await controller.execute({
    id: "open-demo",
    type: "navigate",
    commits: false,
    url: "http://localhost:4000/scholarship",
  });
  const observation = await controller.observe();
  // Pass observation.screenshot and observation.pageContext to Person 3.
  // Person 3 returns a BrowserAction with the same observationId for clicks.
  const action = {
    id: "apply-1",
    type: "click" as const,
    commits: false,
    observationId: observation.observationId,
    x: 450,
    y: 300,
  };
  const result = await controller.execute(action);
  if (result.status === "approval_required") {
    // Emit approval.required and WAIT for a real user response.
    // On approval: execute the unchanged action with this trusted option:
    // { approval: { approvalId: result.approvalId, actionId: action.id } }
    // On denial: await controller.denyApproval(result.approvalId).
  }
} finally {
  await controller.close();
}
```

The example coordinates are illustrative. Use actual coordinates from Person 3
and the associated observation, not hard-coded positions.

`execute(action, options?)` queues actions in order. Typing uses `insertText` into
the focused editable control; use a click or Tab first. It inserts plain text,
including Unicode, without interpreting newlines as keyboard submission. Scrolling
uses signed wheel deltas, bounded to 10000 pixels per axis. Waits are at most ten
seconds. Supported keys: Tab, Shift+Tab, Enter, Space, Escape, arrows, Home, End,
PageUp, PageDown, Backspace, Delete, Control+A, Meta+A and ControlOrMeta+A. There
is no arbitrary JavaScript, shell execution, file upload or clipboard API.

`observe()` queues a screenshot and page map. The observation id is preserved
while the screenshot, page map, scroll, focus/selection and form digest stay the
same. Coordinate proposals are rejected if their observation is stale or absent.
An internal SHA-256 digest of form state is computed inside the page; raw values
are not returned by that check. Hidden form changes invalidate approval too.
Do not change `controller.page` concurrently with execution. It exists only for
trusted manual handoff and diagnostics.

## Approval, manual handoff and stop

Every `commits: true` proposal pauses. Native submit controls, form activation
keys, risky button labels, suspicious navigation paths, explicitly marked
`data-accesspilot-commits="true"` controls, and unknown click targets also pause
even if the model says `commits: false`. Consequential double clicks are rejected;
propose a single click. Password/payment/one-time-code fields require manual
input; file controls and iframe interaction require manual handoff as well.
Mark additional sensitive regions with `data-accesspilot-sensitive`.

Approval is a random id bound to the exact normalized proposal and current page
fingerprint. Only the trusted orchestrator supplies it after the user's approval.
For standard DOM controls, hover and focus changes are tolerated;
approval still requires unchanged DOM, form values, control geometry, viewport,
and scroll position. Canvas and unknown visual targets retain screenshot-based checks.
A different action cannot run while approval is pending. Wrong/stale approvals
and changed pages fail. `denyApproval(id)` consumes the proposal without acting.
Completed or attempted action ids cannot be executed twice. Use a fresh proposal
after inspecting an error; do not automatically retry uncertain interactions.

Native/implicit submit events and `form.submit()` are blocked without approval.
The session also blocks non-GET/HEAD/OPTIONS network requests unless the active
action has matching approval. Unexpected submissions return
`approval_required_by_page` and do not get silently retried with approval.
Approved permission lasts only for the bounded action and is revoked afterward.
This is a conservative controller for controlled demo sites; semantic checks
cannot classify every custom widget or turn an untrusted site into a secure
transaction boundary. All AI/page content remains untrusted.

`stop()` immediately marks the task stopped, rejects queued work as `cancelled`,
and closes the browser to interrupt active I/O. Passing an `AbortSignal` to
`execute` stops the entire controller if it fires, including queued work.
Stopping does not undo input or requests already delivered to a website. There
is no resume after stop: create a new controller. `close()` is an alias for stop.
Execution has a total deadline (default 20000 ms, configurable with
`executionTimeoutMs`) and a limit (default 100 interactions, `maxActions`). A
deadline or action limit stops the session. Approval/validation attempts do not
consume the interaction count. Always close the controller in `finally`.

## Result verification and frontend mapping

Successful interactions return a fresh screenshot, page map and observation id.
Page-side safety failures also include observations when the page remains usable.
An executed interaction is `unverified` unless the orchestrator supplies
`options.expected`:

```ts
{ type: "url", url: "http://localhost:4000/confirmation" }
{ type: "visible", selector: "#confirmation", text: "Application received" }
{ type: "field", selector: "#name", value: "Ada Lovelace" }
```

These checks wait up to 2000 ms by default (`verificationTimeoutMs`, 1–10000).
They return `passed` or `failed`. A failed verification does not mean the action
was rolled back; inspect the returned observation before deciding the next step.
Sensitive field values are never verified through this API. Expected conditions
and selectors must come from trusted orchestration, not executable page code.

Person 5 should map `approval_required` to `approval.required`,
`user_input_required` to `user_input.required`, cancellation to `task.stopped`,
and errors to appropriate task feedback. Successful results can emit screenshot
events and page maps. The frontend step action union does not include `navigate`:
describe navigation through narration/page-map events rather than emitting an
invalid frontend action type. Keep approval ids, action ids and task ids distinct.
Verify trusted expected outcomes before declaring the whole task complete.

## Tests and demo

Run `npm run test:browser` for real Chromium tests covering all actions, approval
and denial, replay/staleness, form guards, URL policy, cancellation of active and
queued work, deadlines/limits, screenshots, DOM context, and the full scholarship
workflow. No sponsor API key is required. Unit tests: `npm test`.

Run `npm run demo:browser` for the headed demo, or append `-- --headless` to run
without a visible window. It compiles with the existing TypeScript dependency,
starts a loopback scholarship site, fills fictional data using mocked Twinly
actions, and waits for an explicit `yes` before submission. A different answer or
EOF declines. Ctrl+C stops it. See [the demo guide](BROWSER-DEMO.md).

The Person 4 module is ready for integration. Real Twinly/Gemma calls, API routes,
SSE streaming and frontend task wiring remain the other team modules' work.
