# lib/ai: Gemma 4 brain

Server-side only. Calls `gemma-4-26b-a4b-it` through the Gemini API. Needs `GEMINI_API_KEY` in `.env.local`.

```ts
import { planTask, mapPage, narrate, explainPage } from "@/lib/ai";
```

| Function                                    | Returns                       | Use it for                                             |
| ------------------------------------------- | ----------------------------- | ------------------------------------------------------ |
| `planTask(goal, pageContext, userDetails?)` | `TaskPlan`                    | Steps, missing details to ask the user, approval flag. |
| `mapPage(pageContext)`                      | `{ title, summary, regions }` | Spread into a `page.map` event.                        |
| `narrate(progress)`                         | `{ text, priority }`          | Spread into a `narration` event.                       |
| `explainPage(pageContext, question?)`       | `string`                      | "Explain this page" requests.                          |

`pageContext` is plain text describing the page (visible text, field labels, buttons). Build it from
Playwright's accessibility snapshot, not from raw HTML.

## Behavior to rely on

- Output is validated with zod. An invalid reply is retried once with the errors fed back, then `GemmaError` is thrown.
- `planTask` always sets `requiresConfirmation` on steps that submit, pay, send or delete, even if the model forgets.
  This does not replace the Twinly `commits: true` gate. Enforce both.
- Page text is fenced as untrusted data in every prompt. Still never put secrets in `pageContext` or `userDetails`.
- Pages over 24,000 characters are truncated.
- Thinking is off by default everywhere (fast mode). Measured on planning: 2.5 to 8 s instead of 12 to 60 s, with the same intent accuracy. Override with `{ thinking: "high" }`.
- Errors are `GemmaError` with a short message. Do not show `cause` to users.

## Tests

```bash
npx vitest run lib/ai                                           # offline, mocked API
node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/ai/gemma.live.test.ts   # real API, needs a key
```
