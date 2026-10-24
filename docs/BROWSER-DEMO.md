# Person 4 browser demo

## Run

```sh
npm ci
npx playwright install chromium
npm run demo:browser
```

On Windows, use `npm.cmd` and `npx.cmd` if PowerShell blocks unsigned npm scripts.
The demo opens its own Chromium window and prints the loopback site address.
It does not use the user's browser profile, credentials or real external sites.

1. Watch it open the scholarship application.
2. Watch it fill Ada Lovelace, ada@example.test, and Computer Science.
3. It prints `approval_required` before submission, even though the mocked click
   deliberately has `commits: false`.
4. Review the browser and terminal summary. Type `yes` in the terminal to approve.
   Any other answer or EOF declines and closes the demo without submitting.
5. It checks for “Application received” and prints demo confirmation AP-1001.
6. Press Enter to close the browser. Ctrl+C stops the run at any point.

`npm run demo:browser -- --headless` runs the same workflow without a window and
still requires approval. Build output stays under ignored `.cache/browser-demo`.

## What the demo proves

The website is a controlled test environment. Mock proposals stand in for the
Twinly adapter, while Chromium execution, page reads, screenshots, submission
approval and result verification are real. API keys and other team modules are
not required. This is not evidence of live Twinly/Gemma integration.

`npm run test:browser` also runs the full workflow automatically, with a test
acting as the trusted approval provider. Separate tests verify denial, stale or
wrong approval, duplicate execution, private-field handoff, blocked submit
bypasses, blocked POST requests, active-navigation stop, AbortSignal, limits,
timeouts and failed outcome checks.

## Team handoff

- Person 3: return `BrowserAction` values from `lib/contracts/browser.ts` and
  preserve the screenshot's `observationId` on coordinate actions. Convert model
  coordinates to viewport CSS pixels. Handle model done/fail separately.
- Person 5: own one controller per task, map results into existing frontend
  events, wait for real approval, supply trusted expected outcomes, call stop
  from the Stop endpoint, and always close sessions. Never auto-retry a submit.
- Person 1: the existing approval/handoff/stop views receive those events through
  Person 5's routes. The CLI does not change the frontend's mocked task mode.

API details and limitations: [BROWSER.md](BROWSER.md).
