import { getAgentDeps } from "./dependencies";
import { TaskService } from "./service";

const KEY = Symbol.for("accesspilot.taskService");
type Holder = { [KEY]?: TaskService };

/** One service per server process. Kept on globalThis so dev-server reloads don't lose running tasks. */
export function getTaskService(): TaskService {
  const holder = globalThis as unknown as Holder;
  holder[KEY] ??= new TaskService({ getDeps: getAgentDeps });
  return holder[KEY];
}
