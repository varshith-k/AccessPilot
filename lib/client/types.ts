import type { StartTaskRequest, TaskEvent } from "@/lib/contracts";

export interface TaskClient {
  start(input: StartTaskRequest): Promise<{ taskId: string }>;
  /**
   * Streams validated events for a task. Returns an unsubscribe function that closes the
   * underlying connection. `onError` receives a `TaskClientError`; non-fatal errors (a single
   * malformed event) do not end the stream.
   */
  subscribe(
    taskId: string,
    onEvent: (event: TaskEvent) => void,
    onError: (error: Error) => void,
  ): () => void;
  approve(taskId: string, approvalId: string): Promise<void>;
  deny(taskId: string, approvalId: string, reason?: string): Promise<void>;
  /** `answer` is the user's reply when the agent asked for details. */
  resume(taskId: string, answer?: string): Promise<void>;
  stop(taskId: string): Promise<void>;
}
