import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { startDemoSite } from "../demo-site/server";
import { createBrowserController, type BrowserController } from "../lib/browser/executor";
import type { BrowserAction, ActionResult, ExecuteActionOptions } from "../lib/contracts/browser";

async function main() {
  const demo = await startDemoSite();
  const prompt = createInterface({ input: stdin, output: stdout });
  const answers = prompt[Symbol.asyncIterator]();
  const ask = async (message: string) => {
    stdout.write(message);
    const answer = await answers.next();
    if (answer.done) return ""; // EOF declines approval; it can never approve.
    return answer.value;
  };
  let controller: BrowserController | undefined;
  const onInterrupt = () => {
    void controller?.stop().catch(() => {});
    prompt.close();
  };
  process.once("SIGINT", onInterrupt);
  try {
    controller = await createBrowserController({
      allowedOrigins: [demo.origin],
      headless: process.argv.includes("--headless"),
    });
    stdout.write(`Local demo: ${demo.origin}\nUsing mocked Twinly proposals and fictional data.\n`);
    const run = async (
      action: BrowserAction,
      options?: ExecuteActionOptions,
    ): Promise<ActionResult> => {
      const result = await controller!.execute(action, options);
      stdout.write(
        `${action.type}: ${result.status}${result.status === "executed" ? ` (${result.verification})` : ""}\n`,
      );
      if (result.status === "failed") throw new Error(result.error.message);
      if (result.status === "cancelled") throw new Error("Demo stopped.");
      if (result.status === "executed" && result.verification === "failed")
        throw new Error("Demo outcome verification failed.");
      return result;
    };
    const proposeClick = async (label: string): Promise<BrowserAction> => {
      const observation = await controller!.observe();
      const target = observation.pageContext.elements.find((element) => element.label === label);
      if (!target?.bounds) throw new Error(`Demo control is missing: ${label}`);
      return {
        id: randomUUID(),
        type: "click",
        commits: false,
        observationId: observation.observationId,
        x: target.bounds.x + target.bounds.width / 2,
        y: target.bounds.y + target.bounds.height / 2,
      };
    };
    await run({ id: randomUUID(), type: "navigate", url: demo.origin, commits: false });
    await run(await proposeClick("Open application"), {
      expected: { type: "url", url: `${demo.origin}/scholarship` },
    });
    for (const [label, selector, value] of [
      ["Full name", "#name", "Ada Lovelace"],
      ["Email", "#email", "ada@example.test"],
      ["Program", "#program", "Computer Science"],
    ] as const) {
      await run(await proposeClick(label));
      await run(
        { id: randomUUID(), type: "type", text: value, commits: false },
        { expected: { type: "field", selector, value } },
      );
    }
    const submit = await proposeClick("Submit application");
    const pending = await run(submit);
    if (pending.status !== "approval_required") throw new Error("Demo did not pause for approval.");
    stdout.write("\nReview: Ada Lovelace | ada@example.test | Computer Science\n");
    const answer = await ask("Submit to the local demo site? Type yes to approve: ");
    if (answer.trim().toLowerCase() !== "yes") {
      await controller.denyApproval(pending.approvalId);
      stdout.write("Not submitted. Approval was declined.\n");
      return;
    }
    await run(submit, {
      approval: { approvalId: pending.approvalId, actionId: submit.id },
      expected: { type: "visible", selector: "#confirmation", text: "Application received" },
    });
    stdout.write("Verified: application received. Demo confirmation AP-1001.\n");
    if (!process.argv.includes("--headless")) await ask("Press Enter to close the demo browser. ");
  } finally {
    process.off("SIGINT", onInterrupt);
    prompt.close();
    await controller?.close();
    await demo.close();
  }
}

void main().catch((error: unknown) => {
  // Executor errors are intentionally sanitized. Do not log actions or screenshots.
  process.stderr.write(`${error instanceof Error ? error.message : "Demo failed."}\n`);
  process.exitCode = 1;
});
