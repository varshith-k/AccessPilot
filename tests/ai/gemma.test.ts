import { describe, expect, it, vi } from "vitest";
import { GemmaError, enforceConfirmation, explainPage, extractJson, narrate, planTask } from "../../lib/ai/gemma";

const validPlan = {
  intent: "fill_application",
  summary: "I will find the application and fill it in.",
  steps: [
    { id: 1, description: "Open the application form", requiresConfirmation: false },
    { id: 2, description: "Fill the provided details", requiresConfirmation: false },
    { id: 3, description: "Review with the user, then submit", requiresConfirmation: false },
  ],
  missingInfo: [{ field: "gpa", question: "What is your GPA?" }],
  requiresConfirmation: false,
  clarifyingQuestion: null,
};

function reply(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
}
const opts = (fetchImpl: typeof fetch) => ({ apiKey: "k", fetchImpl });

describe("extractJson", () => {
  it("handles fences, prose and braces inside strings", () => {
    expect(extractJson('Sure!\n```json\n{"a":"}{","b":{"c":1}}\n```')).toEqual({ a: "}{", b: { c: 1 } });
  });
  it("throws when there is no object", () => {
    expect(() => extractJson("nothing here")).toThrow(SyntaxError);
  });
});

describe("enforceConfirmation", () => {
  it("flags submit steps even if the model did not", () => {
    const out = enforceConfirmation(validPlan as never);
    expect(out.steps[2].requiresConfirmation).toBe(true);
    expect(out.requiresConfirmation).toBe(true);
  });
});

describe("planTask", () => {
  it("returns a validated plan and sends the key as a header, not in the URL", async () => {
    const f = vi.fn().mockResolvedValue(reply(JSON.stringify(validPlan)));
    const plan = await planTask("Apply for this scholarship", "Apply now button", { name: "Alex" }, opts(f));
    expect(plan.requiresConfirmation).toBe(true);
    const [url, init] = f.mock.calls[0];
    expect(url).toContain("gemma-4-26b-a4b-it:generateContent");
    expect(url).not.toContain("key=");
    expect(init.headers["x-goog-api-key"]).toBe("k");
    expect(JSON.parse(init.body).contents[0].parts[0].text).toContain("<page_context>");
  });

  it("retries once with the validation errors, then succeeds", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply('{"intent":"nope"}'))
      .mockResolvedValueOnce(reply(JSON.stringify(validPlan)));
    const plan = await planTask("goal", "page", undefined, opts(f));
    expect(plan.intent).toBe("fill_application");
    expect(JSON.parse(f.mock.calls[1][1].body).contents).toHaveLength(3);
  });

  it("gives up after a second invalid reply", async () => {
    const f = vi.fn().mockImplementation(async () => reply("not json"));
    await expect(planTask("goal", "page", undefined, opts(f))).rejects.toThrow(GemmaError);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("surfaces API errors without retrying", async () => {
    const f = vi.fn().mockResolvedValue(new Response("quota", { status: 429 }));
    await expect(planTask("goal", "page", undefined, opts(f))).rejects.toThrow(/429/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty goal and a missing key", async () => {
    await expect(planTask("  ", "p")).rejects.toThrow(/empty/);
    delete process.env.GEMINI_API_KEY;
    await expect(planTask("goal", "p")).rejects.toThrow(/GEMINI_API_KEY/);
  });
});

describe("narrate / explainPage", () => {
  it("return trimmed text and ignore thought parts", async () => {
    const body = { candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: " Done. " }] } }] };
    const f = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body)));
    expect(await narrate({ kind: "finished", detail: "ok" }, opts(f))).toBe("Done.");
    expect(await explainPage("page", "What is this?", opts(f))).toBe("Done.");
  });
});
