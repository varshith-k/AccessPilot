import type { TaskEvent } from "@/lib/contracts";
import { mockScreenshots } from "./screenshots";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event as a scenario declares it; the mock client fills in taskId, seq, and at. */
export type ScriptedEvent = DistributiveOmit<TaskEvent, "taskId" | "seq" | "at">;

export type ScriptStep =
  | { kind: "emit"; delayMs: number; event: ScriptedEvent }
  /** Pauses until approve or deny is called with this id, then continues with that branch. */
  | { kind: "await_approval"; approvalId: string; approve: ScriptStep[]; deny: ScriptStep[] }
  /** Pauses until resume is called. */
  | { kind: "await_resume"; then: ScriptStep[] };

export interface MockScenario {
  name: MockScenarioName;
  description: string;
  /** The script runs after the automatic `task.started` event. */
  script: ScriptStep[];
}

export const MOCK_SCENARIO_NAMES = [
  "scholarship-happy",
  "scholarship-deny",
  "password-handoff",
  "failure",
  "slow-network",
] as const;

export type MockScenarioName = (typeof MOCK_SCENARIO_NAMES)[number];

export function isMockScenarioName(value: string): value is MockScenarioName {
  return (MOCK_SCENARIO_NAMES as readonly string[]).includes(value);
}

const emit = (delayMs: number, event: ScriptedEvent): ScriptStep => ({
  kind: "emit",
  delayMs,
  event,
});

const SCHOLARSHIP_STEPS = 6;
const PACE = 1200;

const scholarshipPageMap = emit(PACE, {
  type: "page.map",
  title: "Gator Futures Scholarship application",
  summary:
    "This page has a login link, a 6-field application form (name, email, program, start date, and essay), and a Submit button.",
  regions: [
    { name: "Header", description: "Site name and a login link." },
    {
      name: "Application form",
      description: "Full name, email, program dropdown, start date picker, and essay.",
    },
    { name: "Submit button", description: "Sends the application. Needs your approval." },
  ],
});

function stepStart(step: number, description: string): ScriptStep {
  return emit(PACE, {
    type: "step.started",
    step,
    description,
    totalSteps: SCHOLARSHIP_STEPS,
  });
}

/** Steps 1 to 5: fill the scholarship form. `program` lets the deny scenario pick the wrong one. */
function fillScholarshipForm(program: string): ScriptStep[] {
  return [
    emit(PACE, {
      type: "screenshot",
      step: 0,
      imageDataUrl: mockScreenshots.formEmpty,
      alt: "Empty scholarship application form with five fields and a Submit button.",
    }),
    scholarshipPageMap,
    stepStart(1, "Filling in your name"),
    emit(PACE, { type: "narration", text: "Typing your name: Ada Lovelace.", priority: "polite" }),
    emit(PACE, {
      type: "step.completed",
      step: 1,
      description: "Filled in your name",
      action: { type: "type", label: "Full name" },
    }),
    emit(300, {
      type: "screenshot",
      step: 1,
      imageDataUrl: mockScreenshots.formName,
      alt: "Full name field filled with Ada Lovelace.",
    }),
    stepStart(2, "Filling in your email"),
    emit(PACE, {
      type: "narration",
      text: "Typing your email: ada@ufl.edu.",
      priority: "polite",
    }),
    emit(PACE, {
      type: "step.completed",
      step: 2,
      description: "Filled in your email",
      action: { type: "type", label: "Email" },
    }),
    emit(300, {
      type: "screenshot",
      step: 2,
      imageDataUrl: mockScreenshots.formEmail,
      alt: "Email field filled with ada@ufl.edu.",
    }),
    stepStart(3, "Choosing a program"),
    emit(PACE, {
      type: "narration",
      text: "Opening the program dropdown. It has no label, so I matched it by its position.",
      priority: "polite",
    }),
    emit(PACE, { type: "narration", text: `Selected ${program}.`, priority: "polite" }),
    emit(PACE, {
      type: "step.completed",
      step: 3,
      description: `Selected ${program}`,
      action: { type: "click", label: program },
    }),
    emit(300, {
      type: "screenshot",
      step: 3,
      imageDataUrl: mockScreenshots.formProgram,
      alt: `Program dropdown closed, showing ${program}.`,
    }),
    stepStart(4, "Choosing a start date"),
    emit(PACE, {
      type: "narration",
      text: "The date picker is a grid of unlabeled buttons. Choosing January 12, 2027.",
      priority: "polite",
    }),
    emit(PACE, {
      type: "step.completed",
      step: 4,
      description: "Chose January 12, 2027",
      action: { type: "click", label: "12" },
    }),
    emit(300, {
      type: "screenshot",
      step: 4,
      imageDataUrl: mockScreenshots.formDate,
      alt: "Start date field showing January 12, 2027.",
    }),
    stepStart(5, "Writing the essay answer"),
    emit(PACE, {
      type: "narration",
      text: "Pasting the essay you provided: 250 words about accessible technology.",
      priority: "polite",
    }),
    emit(PACE, {
      type: "step.completed",
      step: 5,
      description: "Added your essay",
      action: { type: "type", label: "Essay" },
    }),
    emit(300, {
      type: "screenshot",
      step: 5,
      imageDataUrl: mockScreenshots.formEssay,
      alt: "Essay box filled with two lines of text.",
    }),
  ];
}

function scholarshipSubmit(program: string): ScriptStep[] {
  return [
    stepStart(6, "Submitting the application"),
    emit(PACE, {
      type: "screenshot",
      step: 6,
      imageDataUrl: mockScreenshots.formReview,
      alt: "All fields filled. The Submit button is focused but not pressed.",
    }),
    emit(PACE, {
      type: "approval.required",
      approvalId: "approval-submit",
      action: "Submit application",
      summary: "Submit the Gator Futures Scholarship application with these details?",
      fields: [
        { label: "Full name", value: "Ada Lovelace" },
        { label: "Email", value: "ada@ufl.edu" },
        { label: "Program", value: program },
        { label: "Start date", value: "January 12, 2027" },
        { label: "Essay", value: "250 words about accessible technology" },
      ],
    }),
    {
      kind: "await_approval",
      approvalId: "approval-submit",
      approve: [
        emit(600, { type: "narration", text: "Submitting now.", priority: "polite" }),
        emit(PACE, {
          type: "step.completed",
          step: 6,
          description: "Submitted the application",
          action: { type: "click", label: "Submit" },
        }),
        emit(300, {
          type: "screenshot",
          step: 6,
          imageDataUrl: mockScreenshots.confirmation,
          alt: "Green confirmation banner: Application received. Confirmation number 4821.",
        }),
        emit(PACE, {
          type: "task.completed",
          summary: "Submitted. Confirmation number 4821.",
        }),
      ],
      // Same wording as the orchestrator's finishDenied (lib/agent/orchestrator.ts).
      deny: [
        emit(600, { type: "narration", text: "Okay, I won't do that.", priority: "polite" }),
        emit(PACE, {
          type: "task.completed",
          summary:
            "Not done: Submit application. I stopped there, so nothing was submitted or changed.",
        }),
      ],
    },
  ];
}

const scholarshipHappy: MockScenario = {
  name: "scholarship-happy",
  description: "Fill a scholarship form, ask before submitting, and confirm the result.",
  script: [...fillScholarshipForm("Computer Science"), ...scholarshipSubmit("Computer Science")],
};

const scholarshipDeny: MockScenario = {
  name: "scholarship-deny",
  description:
    "Same form, but the agent picks the wrong program, so the user has a reason to decline.",
  script: [
    ...fillScholarshipForm("Computer Engineering"),
    ...scholarshipSubmit("Computer Engineering"),
  ],
};

const signInHandoff: MockScenario = {
  name: "password-handoff",
  description: "Reach a password field and hand control to the user until they press Continue.",
  script: [
    emit(PACE, {
      type: "screenshot",
      step: 0,
      imageDataUrl: mockScreenshots.loginEmpty,
      alt: "Sign-in page with an email field, a password field, and a Sign in button.",
    }),
    emit(PACE, {
      type: "page.map",
      title: "Student portal sign in",
      summary:
        "This page has a sign-in form with an email field, a password field, and a Sign in button.",
      regions: [{ name: "Sign-in form", description: "Email, password, and a Sign in button." }],
    }),
    emit(PACE, {
      type: "step.started",
      step: 1,
      description: "Entering your email",
      totalSteps: 3,
    }),
    emit(PACE, { type: "narration", text: "Typing your email: ada@ufl.edu.", priority: "polite" }),
    emit(PACE, {
      type: "step.completed",
      step: 1,
      description: "Entered your email",
      action: { type: "type", label: "Email" },
    }),
    emit(300, {
      type: "screenshot",
      step: 1,
      imageDataUrl: mockScreenshots.loginEmail,
      alt: "Email field filled with ada@ufl.edu.",
    }),
    emit(PACE, {
      type: "step.started",
      step: 2,
      description: "Waiting for you to type your password",
      totalSteps: 3,
    }),
    emit(300, {
      type: "screenshot",
      step: 2,
      imageDataUrl: mockScreenshots.loginHandoff,
      alt: "Password field highlighted and empty.",
    }),
    emit(PACE, {
      type: "user_input.required",
      reason: "sensitive_value",
      instructions:
        "I don't type passwords. Please type your password in the browser window, then press Continue.",
    }),
    {
      kind: "await_resume",
      then: [
        emit(600, { type: "narration", text: "Thanks. Signing you in.", priority: "polite" }),
        emit(PACE, {
          type: "step.completed",
          step: 2,
          description: "You entered your password",
          action: { type: "wait" },
        }),
        emit(PACE, { type: "step.started", step: 3, description: "Signing in", totalSteps: 3 }),
        emit(300, {
          type: "screenshot",
          step: 3,
          imageDataUrl: mockScreenshots.loginSubmit,
          alt: "Both fields filled; the Sign in button is focused.",
        }),
        emit(PACE, {
          type: "step.completed",
          step: 3,
          description: "Signed in",
          action: { type: "click", label: "Sign in" },
        }),
        emit(300, {
          type: "screenshot",
          step: 3,
          imageDataUrl: mockScreenshots.dashboard,
          alt: "Student dashboard with three summary cards.",
        }),
        emit(PACE, { type: "task.completed", summary: "Signed in. You're on your dashboard." }),
      ],
    },
  ],
};

const failure: MockScenario = {
  name: "failure",
  description: "Fail partway through with a recoverable error.",
  script: [
    emit(PACE, {
      type: "screenshot",
      step: 0,
      imageDataUrl: mockScreenshots.formEmpty,
      alt: "Empty scholarship application form.",
    }),
    scholarshipPageMap,
    stepStart(1, "Filling in your name"),
    emit(PACE, {
      type: "step.completed",
      step: 1,
      description: "Filled in your name",
      action: { type: "type", label: "Full name" },
    }),
    stepStart(2, "Filling in your email"),
    emit(PACE, {
      type: "step.completed",
      step: 2,
      description: "Filled in your email",
      action: { type: "type", label: "Email" },
    }),
    stepStart(3, "Choosing a program"),
    emit(PACE, {
      type: "narration",
      text: "Looking for the program dropdown.",
      priority: "polite",
    }),
    emit(300, {
      type: "screenshot",
      step: 3,
      imageDataUrl: mockScreenshots.formProgramMissing,
      alt: "The program field is outlined in red and its dropdown is not responding.",
    }),
    emit(PACE * 2, {
      type: "task.failed",
      code: "element_not_found",
      message:
        "I couldn't open the program dropdown. The page may have changed or be loading slowly. Nothing was submitted. You can try again.",
      recoverable: true,
    }),
  ],
};

const SLOW = 9000;

const slowNetwork: MockScenario = {
  name: "slow-network",
  description: "Long gaps between events to exercise the still-working messages.",
  script: [
    emit(SLOW, {
      type: "page.map",
      title: "Gator Futures Scholarship",
      summary:
        "This page has a heading, three paragraphs about the scholarship, and a deadlines box.",
      regions: [
        { name: "About", description: "Three paragraphs describing the scholarship." },
        { name: "Deadlines", description: "A highlighted box with the application deadline." },
      ],
    }),
    emit(SLOW, {
      type: "step.started",
      step: 1,
      description: "Finding the deadline",
      totalSteps: 2,
    }),
    emit(SLOW, {
      type: "narration",
      text: "The page is loading slowly. Still looking.",
      priority: "polite",
    }),
    emit(SLOW, {
      type: "step.completed",
      step: 1,
      description: "Found the deadlines box",
      action: { type: "scroll", label: "Deadlines" },
    }),
    emit(SLOW, {
      type: "screenshot",
      step: 1,
      imageDataUrl: mockScreenshots.deadline,
      alt: "Deadlines box highlighted, reading March 1, 2027.",
    }),
    emit(SLOW, {
      type: "step.started",
      step: 2,
      description: "Reading the deadline",
      totalSteps: 2,
    }),
    emit(SLOW, {
      type: "step.completed",
      step: 2,
      description: "Read the deadline",
      action: { type: "wait" },
    }),
    emit(SLOW, {
      type: "task.completed",
      summary: "The application deadline is March 1, 2027.",
    }),
  ],
};

export const DEMO_FOLLOW_UP_SUMMARY =
  "Demo mode only plays its scripted example, so it can't do that. Nothing on the page was changed. Start a new task with the original goal to replay the example, or connect the live backend for other requests.";

/**
 * Played for any goal other than the one the demo first ran (a follow-up such as "Now find the
 * deadline"). The demo can't act on new requests, so it says so instead of replaying the form
 * and asking to submit it.
 */
export const demoFollowUpScript: ScriptStep[] = [
  emit(400, {
    type: "narration",
    text: "This is demo mode, so I can only play the scripted example.",
    priority: "polite",
  }),
  emit(400, { type: "task.completed", summary: DEMO_FOLLOW_UP_SUMMARY }),
];

export const mockScenarios: { [N in MockScenarioName]: MockScenario } = {
  "scholarship-happy": scholarshipHappy,
  "scholarship-deny": scholarshipDeny,
  "password-handoff": signInHandoff,
  failure,
  "slow-network": slowNetwork,
};
