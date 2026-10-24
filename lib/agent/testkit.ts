import { vi } from "vitest";
import type { ActionResult, BrowserAction, TaskEvent } from "@/lib/contracts";
import { TINY_PNG, createFakeDeps } from "./fakes";
import { TaskStore, type TaskRecord } from "./taskStore";
import { runTask } from "./orchestrator";
import {
  DEFAULT_LIMITS,
  type AgentDeps,
  type AgentLimits,
  type BrowserDriver,
  type NextAction,
} from "./types";

export const click = (
  id: string,
  x: number,
  y: number,
  label = "Button",
  commits = false,
): BrowserAction => ({
  id,
  type: "click",
  x,
  y,
  label,
  commits,
});
export const typeText = (id: string, text: string, label = "Field"): BrowserAction => ({
  id,
  type: "type",
  text,
  label,
  commits: false,
});
export const act = (action: BrowserAction): NextAction => ({ kind: "action", action });
export const done = (summary = "All done."): NextAction => ({ kind: "done", summary });

const executed = (action: BrowserAction): ActionResult => ({
  actionId: action.id,
  status: "executed",
  verification: "unverified",
});

/** Fake deps from the scripted flow, with any piece replaced. `script` is what Twinly will say, in order. */
export function makeDeps(
  script: NextAction[],
  over: Partial<AgentDeps> = {},
  browser: Partial<BrowserDriver> = {},
) {
  const base = createFakeDeps({ stepDelayMs: 0 });
  const queue = [...script];
  const execute = vi.fn(async (action: BrowserAction) => executed(action));
  const close = vi.fn(async () => {});
  const driver: BrowserDriver = {
    open: async () => (await base.createBrowser()).open("x"),
    observe: async () => (await base.createBrowser()).observe(),
    execute,
    close,
    ...browser,
  };
  const deps: AgentDeps = {
    ...base,
    actions: { nextAction: vi.fn(async () => queue.shift() ?? done()) },
    createBrowser: async () => driver,
    ...over,
  };
  return { deps, execute, close, driver };
}

export interface Run {
  store: TaskStore;
  task: TaskRecord;
  finished: Promise<void>;
  types: () => string[];
  find: <T extends TaskEvent["type"]>(type: T) => Extract<TaskEvent, { type: T }> | undefined;
  last: () => TaskEvent | undefined;
  waitFor: (type: TaskEvent["type"]) => Promise<void>;
}

export function start(deps: AgentDeps, limits: Partial<AgentLimits> = {}): Run {
  const store = new TaskStore();
  const input = { url: "http://localhost:4000/scholarship", goal: "Apply for the scholarship" };
  const task = store.create(input.url, input.goal);
  const finished = runTask(deps, task, input, { ...DEFAULT_LIMITS, ...limits });
  return {
    store,
    task,
    finished,
    types: () => task.events.map((e) => e.type),
    find: (type) => task.events.find((e) => e.type === type) as never,
    last: () => task.events.at(-1),
    waitFor: (type) =>
      vi.waitFor(() => {
        if (!task.events.some((e) => e.type === type)) throw new Error(`no ${type} yet`);
      }),
  };
}

export { TINY_PNG };
