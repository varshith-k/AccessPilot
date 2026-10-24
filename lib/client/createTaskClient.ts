import { HttpTaskClient } from "./HttpTaskClient";
import { MockTaskClient } from "./MockTaskClient";
import { isMockScenarioName, type MockScenarioName } from "./mock/scenarios";
import type { TaskClient } from "./types";

export type TaskClientMode = "mock" | "http";

export interface TaskClientConfig {
  mode: TaskClientMode;
  scenario: MockScenarioName;
  /** Multiplier for scripted mock delays; 1 is real time. */
  mockSpeed: number;
}

export const DEFAULT_SCENARIO: MockScenarioName = "scholarship-happy";

interface ResolveInput {
  /** Value of NEXT_PUBLIC_TASK_CLIENT. */
  envMode: string | undefined;
  /** window.location.search, if available. */
  search: string;
  nodeEnv: string | undefined;
}

function parseMockSpeed(value: string | null): number {
  if (value === null) return 1;
  const speed = Number(value);
  return Number.isFinite(speed) && speed >= 0 && speed <= 10 ? speed : 1;
}

/**
 * `NEXT_PUBLIC_TASK_CLIENT=http` selects the real backend; anything else uses mocks.
 * Outside production, `?mock=<scenario>` forces mock mode with that scenario, and
 * `?mockSpeed=0.1` plays mock scenarios ten times faster (used by the E2E tests).
 */
export function resolveTaskClientConfig({
  envMode,
  search,
  nodeEnv,
}: ResolveInput): TaskClientConfig {
  const params = nodeEnv === "production" ? null : new URLSearchParams(search);
  const requested = params?.get("mock") ?? null;
  const mockSpeed = parseMockSpeed(params?.get("mockSpeed") ?? null);
  if (requested !== null && isMockScenarioName(requested)) {
    return { mode: "mock", scenario: requested, mockSpeed };
  }
  return { mode: envMode === "http" ? "http" : "mock", scenario: DEFAULT_SCENARIO, mockSpeed };
}

export function createTaskClient(config: TaskClientConfig): TaskClient {
  return config.mode === "http"
    ? new HttpTaskClient()
    : new MockTaskClient({ scenario: config.scenario, speed: config.mockSpeed });
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
