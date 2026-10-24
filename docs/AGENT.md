# Agent backend: orchestrator, API routes, demo site

This is Part 5: the code that connects the UI to Gemma, Twinly and Playwright.
The wire format is [CONTRACT.md](CONTRACT.md); the browser contract is [BROWSER.md](BROWSER.md).

```
UI ──HTTP/SSE──> app/api/**  ──>  TaskService ──>  runTask (lib/agent/orchestrator.ts)
                                      │                 │
                                  TaskStore             ├─ Planner       (Gemma, lib/ai)
                          (events, seq, replay,         ├─ ActionProvider (Twinly, lib/twinly)
                           approve/deny/resume/stop)    └─ BrowserDriver  (Playwright, lib/browser)
```

`runTask` only knows the three ports in `lib/agent/types.ts`. Anything that fits them can be plugged
in, so every module can be developed and tested alone.

## Run it today (no other module needed)

```bash
ACCESSPILOT_AGENT=fake NEXT_PUBLIC_TASK_CLIENT=http npm run dev   # UI + API with scripted fakes
npm run demo-site                                                 # http://localhost:4000/scholarship
```

`ACCESSPILOT_FAKE_DELAY_MS=0` removes the pause between fake steps. Without `ACCESSPILOT_AGENT=fake`
the API answers `500 internal_error` ("isn't set up on this server yet") until the real wiring exists.

## The loop

1. `task.started`, open the browser, `screenshot` step 0.
2. Gemma `mapPage` → `page.map`; Gemma `planTask` → narration of the summary. A `clarifyingQuestion`
   ends the task with `task.failed` (`needs_clarification`, recoverable). Details the plan needs that
   the server's profile lacks become `user_input.required` (`other`) and wait for `resume`.
3. Repeat up to 25 times: Twinly `nextAction` → `step.started` → hand-off check → approval check →
   `execute` → `step.completed` → `screenshot` → narration.
4. Twinly `done` → `task.completed`. Twinly `fail`, too many failures, the step limit, or a crash →
   `task.failed` with a plain message and `recoverable: true`.
5. The browser is always closed.

## Safety rules, and where they are enforced

| Rule                                                                                    | Where                                                                            | Tested in                                  |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| `commits: true` blocks until the exact `approvalId` is approved                         | `orchestrator.ts` (`requestApproval`)                                            | `orchestrator.test.ts` › approval gate     |
| An action the browser flags (`approval_required`) is gated too, using the browser's id  | `orchestrator.ts`                                                                | › gates an action only the browser flagged |
| Never auto-approve; no timeout approves                                                 | no timer touches a pending approval                                              | › never auto-approves                      |
| Deny runs nothing and ends with `task.completed` "Not done…"                            | `finishDenied`                                                                   | › does not run a committing action         |
| A stale or different `approvalId` is never acted on (`409` / `404`)                     | `taskStore.ts` (`decide`)                                                        | `service.test.ts`, `routes.test.ts`        |
| Passwords, card numbers, CAPTCHAs go to the user via `user_input.required`; never typed | `sensitive.ts` + `orchestrator.ts`                                               | › hand-off of sensitive fields             |
| Stop is immediate; nothing reaches the browser afterwards, even right after an approve  | `taskStore.stop` emits `task.stopped` and aborts; `execute` re-checks the signal | › stop                                     |
| Typed text and keys never appear in events                                              | `describe()` in `orchestrator.ts`                                                | › no leaking of what the agent types       |
| Events are validated against the contract before they are sent                          | `taskStore.emit` (`taskEventSchema.parse`)                                       | `service.test.ts`                          |
| Errors shown to users are plain sentences; internals and keys are never included        | `http.ts` `errorResponse`, `task.failed` messages                                | `http.test.ts`, › fails recoverably        |
| Tasks have a 5-minute cap (`task.stopped`, `by: "system"`) and at most 2 run at once    | `service.ts`                                                                     | `service.test.ts`                          |

## Plugging in the real modules

Edit `getAgentDeps()` in `lib/agent/dependencies.ts`.

**Gemma** (done, merged in PR #3): `getAgentDeps()` already uses it when `ACCESSPILOT_PLANNER=gemma`
and `GEMINI_API_KEY` is set. It plans, describes pages and narrates; Twinly and the browser stay
scripted until their modules land.

```bash
ACCESSPILOT_AGENT=fake ACCESSPILOT_PLANNER=gemma NEXT_PUBLIC_TASK_CLIENT=http npm run dev
```

Gemma's plan can ask for details the demo profile lacks (for example the essay). The task then
pauses with `user_input.required` and continues after Resume. A planning call takes several seconds.

**Twinly** (done, `lib/twinly` plus `lib/agent/twinlyActions.ts`): turn it on with
`ACCESSPILOT_ACTIONS=twinly` and `TWINLY_API_KEY` in `.env.local`. It needs `ACCESSPILOT_BROWSER=real`,
because Twinly reads real screenshots.

```bash
ACCESSPILOT_AGENT=fake ACCESSPILOT_PLANNER=gemma ACCESSPILOT_BROWSER=real ACCESSPILOT_ACTIONS=twinly \
  NEXT_PUBLIC_TASK_CLIENT=http npm run dev
```

- Each step sends Twinly the screenshot, the viewport, the goal, how the earlier steps went, and the
  page's labelled controls as hints. It answers with one action, already converted to viewport pixels.
- Twinly's `commits: true` becomes the action's `commits`, so the user is asked before it runs.
- `done` and `fail` are completion states, never browser actions. A `fail` that Twinly marks
  `sensitive_value` becomes a hand-over to the user (`user_input.required`).
- Every step is one billed request. A task stops after 30 Twinly requests; change that with
  `ACCESSPILOT_TWINLY_MAX_REQUESTS`. Plans have small daily quotas, so check yours first: a full
  scholarship task takes roughly 10 requests.
- The user's approved details (`userDetails`) are added to the goal Twinly sees, because a model
  that only reads "complete this application" cannot type a name it was never told. Keys that look
  like passwords, card numbers or codes are left out, and long values are cut.
- **Twinly's coordinates are not always on its documented grid.** The same request has come back as
  grid values (500, 481) and as image pixels (640, 346). Each click is read both ways and the
  reading that lands on a control with the name Twinly gave is used (`resolveClickPoint`). Worth
  reporting to Twinly.
- A click that still lands beside its field is pulled onto the control it names. A click Twinly marks as
  consequential must land on the control it names, because the user approves it by that name; if it
  doesn't, and exactly one control carries the name, it is moved there (`snapClick`).
- `ACCESSPILOT_DEBUG=1` logs each step's coordinates, what was under them, the result code and Twinly's
  token usage. It never logs typed text.
- Measured on the demo form: a full run is about 12 steps and 12 Twinly calls (roughly 50,000 tokens, 4 to
  5 seconds per call), with one approval prompt, for the final Submit. The model is not deterministic, so
  record more than one take.
- If Twinly can't be used (usage limit, bad key, network), the task ends with a plain `task.failed`
  message. It never falls back silently to a scripted answer.

**Browser** (done, Harshini's controller in `lib/browser`): `lib/agent/browserDriver.ts` wraps it as a
`BrowserDriver`. Turn it on with `ACCESSPILOT_BROWSER=real` (add `ACCESSPILOT_BROWSER_HEADED=1` to
watch the window). The browser may only visit the origin of the address the user gave. The scripted
Twinly stand-in then finds controls by name on the live page.

```bash
ACCESSPILOT_AGENT=fake ACCESSPILOT_PLANNER=gemma ACCESSPILOT_BROWSER=real \
  NEXT_PUBLIC_TASK_CLIENT=http npm run dev          # then use http://localhost:4000/scholarship
```

How the orchestrator works with her controller's rules:

- Clicks are only accepted against the latest view, so the orchestrator stamps each click with the
  `observationId` of the view it was planned from, and moves to the newest one after every action.
- The first `execute` call for a consequential action carries no approval. The controller answers with its
  own approval id; the user's approval is then applied to that id, so the user is asked once.
- **Stop** reaches the controller at once: when a task is stopped, the orchestrator calls the driver's
  `stop()` (the controller's `stop()`), which interrupts a page that is still loading and any action in
  flight. A Stop that arrives while Chromium is still starting closes it as soon as it is up.
- `user_input_required` results (private or manual controls) become `user_input.required` and wait for
  Resume. Elements the page marks `sensitive`, or `type=password`, are handed over before any click.

## Open points for the other owners

- **Approval ids.** Settled: see "How the orchestrator works with her controller's rules" above.
- **`navigate` events.** `actionTypeSchema` has no `navigate`, so a navigate step is reported as
  `wait` with the label "Opened host". Adding `navigate` to the contract needs Nandhan.
- **Screenshot size.** Screenshots over 700,000 characters are skipped. Downscale or use JPEG in the
  executor; the contract asks for about 500 KB.
- **State is in memory.** A server restart loses running tasks, and one server process is assumed.

## Demo site

`demo-site/scholarship.html` (served by `scholarship-server.mjs`) is a plain, accessible scholarship form (name, email, program, start date, essay, Save
draft, Submit). `npm run demo-site` serves it on `127.0.0.1:4000`. A complete submission returns
"Confirmation number 4821", matching the scripted demo. It stores nothing and escapes everything it echoes.
