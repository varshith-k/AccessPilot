import { HttpTaskClient } from "./HttpTaskClient";
import { MockTaskClient } from "./MockTaskClient";
import { isMockScenarioName, type MockScenarioName } from "./mock/scenarios";
import type { TaskClient } from "./types";

export type TaskClientMode = "mock" | "http";

export interface TaskClientConfig {
  mode: TaskClientMode;
  scenario: MockScenarioName;
}

export const DEFAULT_SCENARIO: MockScenarioName = "scholarship-happy";

interface ResolveInput {
  /** Value of NEXT_PUBLIC_TASK_CLIENT. */
  envMode: string | undefined;
  /** window.location.search, if available. */
  search: string;
  nodeEnv: string | undefined;
}

/**
 * `NEXT_PUBLIC_TASK_CLIENT=http` selects the real backend; anything else uses mocks.
 * Outside production, `?mock=<scenario>` forces mock mode with that scenario.
 */
export function resolveTaskClientConfig({
  envMode,
  search,
  nodeEnv,
}: ResolveInput): TaskClientConfig {
  const requested = nodeEnv === "production" ? null : new URLSearchParams(search).get("mock");
  if (requested !== null && isMockScenarioName(requested)) {
    return { mode: "mock", scenario: requested };
  }
  return { mode: envMode === "http" ? "http" : "mock", scenario: DEFAULT_SCENARIO };
}

export function createTaskClient(config: TaskClientConfig): TaskClient {
  return config.mode === "http"
    ? new HttpTaskClient()
    : new MockTaskClient({ scenario: config.scenario });
}

export function createTaskClientFromEnvironment(): TaskClient {
  return createTaskClient(
    resolveTaskClientConfig({
      envMode: process.env.NEXT_PUBLIC_TASK_CLIENT,
      search: typeof window === "undefined" ? "" : window.location.search,
      nodeEnv: process.env.NODE_ENV,
    }),
  );
}
