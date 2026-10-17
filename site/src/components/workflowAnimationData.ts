export type TerminalLineKind = "command" | "output" | "question" | "choice";

export type TranscriptLine = {
  kind: TerminalLineKind;
  text: string;
};

export type DemoIssue = {
  number: number;
  title: string;
  initialMeta: string;
  finalMeta: string;
  labelPool: string[];
  finalLabels: string[];
};

export type AnimationEvent =
  | {
      type: "terminal-line";
      kind: TerminalLineKind;
      text: string;
      typed?: boolean;
      delayAfter?: number;
    }
  | {
      type: "prompt";
      question: string;
      options: string[];
      selected: string;
      delayAfter?: number;
    }
  | { type: "terminal-clear"; delayAfter?: number }
  | { type: "split"; delayAfter?: number }
  | { type: "issue-add"; number: number; delayAfter?: number }
  | { type: "issue-highlight"; number?: number; delayAfter?: number }
  | {
      type: "issue-labels";
      number: number;
      labels: string[];
      meta?: string;
      delayAfter?: number;
    }
  | { type: "issue-meta"; number: number; meta: string; delayAfter?: number };

export const demoIssues: DemoIssue[] = [
  {
    number: 42,
    title: "Add visual proof for the onboarding dashboard",
    initialMeta: "opened by patchmill-demo · awaiting triage",
    finalMeta: "patchmill agent finished · ready for human review",
    labelPool: [
      "agent-ready",
      "in-progress",
      "agent-done",
      "spec-review",
      "spec-approved",
    ],
    finalLabels: ["agent-done", "spec-approved"],
  },
  {
    number: 39,
    title: "Document repo-local Pi auth repair flow",
    initialMeta: "opened by docs-lead · awaiting triage",
    finalMeta: "opened by docs-lead · waiting for details",
    labelPool: ["needs-info"],
    finalLabels: ["needs-info"],
  },
  {
    number: 37,
    title: "Triage flaky setup-test-repo bootstrap",
    initialMeta: "opened by qa-bot · awaiting triage",
    finalMeta: "opened by qa-bot · blocked by issue #12",
    labelPool: ["blocked"],
    finalLabels: ["blocked"],
  },
  {
    number: 34,
    title: "Shape provider onboarding around team policy",
    initialMeta: "opened by platform-team · awaiting triage",
    finalMeta: "opened by platform-team · needs human decision",
    labelPool: ["needs-info"],
    finalLabels: ["needs-info"],
  },
];

export const animationEvents: AnimationEvent[] = [
  {
    type: "terminal-line",
    kind: "command",
    text: "patchmill init --provider github-gh",
    typed: true,
    delayAfter: 260,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Patchmill repository setup",
    delayAfter: 360,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Host: ready (GitHub via gh)",
    delayAfter: 360,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Configuration: written",
    delayAfter: 240,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Skills installed; reviewer provisioned; local excludes added",
    delayAfter: 360,
  },
  {
    type: "terminal-line",
    kind: "command",
    text: "patchmill auth",
    delayAfter: 180,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Pi: use /login for provider authentication",
    delayAfter: 180,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Pi: use /model to select a model",
    delayAfter: 180,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Pi uses .patchmill/pi-agent for local credentials and settings",
    delayAfter: 180,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Patchmill is ready for this repository.",
    delayAfter: 520,
  },
  { type: "terminal-clear", delayAfter: 260 },
  {
    type: "terminal-line",
    kind: "command",
    text: "patchmill setup-test-repo --provider github-gh --repo patchmill-demo/team-lunch-poll",
    typed: true,
    delayAfter: 260,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Creating demo repository patchmill-demo/team-lunch-poll...",
    delayAfter: 220,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Repository created",
    delayAfter: 180,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Labels configured",
    delayAfter: 180,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Preparing seeded issues",
    delayAfter: 220,
  },
  { type: "split", delayAfter: 380 },
  {
    type: "terminal-line",
    kind: "output",
    text: "Creating issue #42 Add visual proof for the onboarding dashboard",
    delayAfter: 220,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Issue #42 created",
    delayAfter: 120,
  },
  { type: "issue-add", number: 42, delayAfter: 360 },
  {
    type: "terminal-line",
    kind: "output",
    text: "Creating issue #39 Document repo-local Pi auth repair flow",
    delayAfter: 220,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Issue #39 created",
    delayAfter: 120,
  },
  { type: "issue-add", number: 39, delayAfter: 360 },
  {
    type: "terminal-line",
    kind: "output",
    text: "Creating issue #37 Triage flaky setup-test-repo bootstrap",
    delayAfter: 220,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Issue #37 created",
    delayAfter: 120,
  },
  { type: "issue-add", number: 37, delayAfter: 360 },
  {
    type: "terminal-line",
    kind: "output",
    text: "Creating issue #34 Shape provider onboarding around team policy",
    delayAfter: 220,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Issue #34 created",
    delayAfter: 120,
  },
  { type: "issue-add", number: 34, delayAfter: 420 },
  {
    type: "terminal-line",
    kind: "output",
    text: "Demo repository ready.",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Run patchmill triage to classify open work.",
    delayAfter: 520,
  },
  { type: "terminal-clear", delayAfter: 260 },
  {
    type: "terminal-line",
    kind: "command",
    text: "patchmill triage",
    typed: true,
    delayAfter: 240,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Reading open issues from GitHub...",
    delayAfter: 200,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Found 4 open issues",
    delayAfter: 220,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Analyzing #42 Add visual proof for the onboarding dashboard",
    delayAfter: 120,
  },
  { type: "issue-highlight", number: 42, delayAfter: 260 },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ #42 returned agent-ready",
    delayAfter: 180,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ #42 ready for agent workflow",
    delayAfter: 160,
  },
  {
    type: "issue-labels",
    number: 42,
    labels: ["agent-ready"],
    meta: "opened by patchmill-demo · ready for run-once",
    delayAfter: 420,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Analyzing #39 Document repo-local Pi auth repair flow",
    delayAfter: 120,
  },
  { type: "issue-highlight", number: 39, delayAfter: 220 },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ #39 returned needs-info",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ #39 needs more details",
    delayAfter: 160,
  },
  {
    type: "issue-labels",
    number: 39,
    labels: ["needs-info"],
    meta: "opened by docs-lead · waiting for details",
    delayAfter: 360,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Analyzing #37 Triage flaky setup-test-repo bootstrap",
    delayAfter: 120,
  },
  { type: "issue-highlight", number: 37, delayAfter: 220 },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ #37 returned blocked",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ #37 blocked by issue #12",
    delayAfter: 160,
  },
  {
    type: "issue-labels",
    number: 37,
    labels: ["blocked"],
    meta: "opened by qa-bot · blocked by issue #12",
    delayAfter: 360,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Analyzing #34 Shape provider onboarding around team policy",
    delayAfter: 120,
  },
  { type: "issue-highlight", number: 34, delayAfter: 220 },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ #34 returned needs-info",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ #34 needs human input",
    delayAfter: 160,
  },
  {
    type: "issue-labels",
    number: 34,
    labels: ["needs-info"],
    meta: "opened by platform-team · needs human decision",
    delayAfter: 420,
  },
  { type: "issue-highlight", delayAfter: 120 },
  {
    type: "terminal-line",
    kind: "output",
    text: "Triage complete.",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "4 issues updated.",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "1 issue is ready for run-once.",
    delayAfter: 520,
  },
  { type: "terminal-clear", delayAfter: 260 },
  {
    type: "terminal-line",
    kind: "command",
    text: "patchmill run-once",
    typed: true,
    delayAfter: 240,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Finding next eligible issue...",
    delayAfter: 180,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Selected #42 Add visual proof for the onboarding dashboard",
    delayAfter: 180,
  },
  { type: "issue-highlight", number: 42, delayAfter: 220 },
  {
    type: "issue-labels",
    number: 42,
    labels: ["in-progress"],
    meta: "patchmill agent is planning · worktree active",
    delayAfter: 420,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Creating isolated worktree...",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Worktree ready at .worktrees/agent-issue-42-visual-proof",
    delayAfter: 180,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Starting Pi agent workflow...",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Writing the spec on the issue branch",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Pushed spec and opened draft pull request",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Verified remote branch and spec",
    delayAfter: 360,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Planning session completed.",
    delayAfter: 180,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Spec approval required before the plan and implementation.",
    delayAfter: 260,
  },
  {
    type: "issue-labels",
    number: 42,
    labels: ["spec-review"],
    meta: "spec pushed · waiting for human approval",
    delayAfter: 420,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Human reviews the spec and adds spec-approved and agent-ready",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "command",
    text: "patchmill run-once --issue 42",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Planning writes the plan; implementation pushes the ready pull request",
    delayAfter: 320,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Kernel verifies the open, non-draft pull request closes #42",
    delayAfter: 160,
  },
  {
    type: "issue-labels",
    number: 42,
    labels: ["agent-done", "spec-approved"],
    meta: "ready pull request verified · human review next",
    delayAfter: 0,
  },
];

export const staticTranscript: TranscriptLine[] = [
  { kind: "command", text: "patchmill init --provider github-gh" },
  {
    kind: "output",
    text: "Configuration written; skills and reviewer installed",
  },
  { kind: "command", text: "patchmill auth" },
  { kind: "output", text: "Pi: use /login and /model in .patchmill/pi-agent" },
  {
    kind: "command",
    text: "patchmill setup-test-repo --provider github-gh --repo patchmill-demo/team-lunch-poll",
  },
  { kind: "output", text: "Demo repository and seeded issues created" },
  { kind: "command", text: "patchmill triage" },
  { kind: "output", text: "Applied configured readiness labels" },
  { kind: "command", text: "patchmill run-once" },
  {
    kind: "output",
    text: "#42: spec pushed, draft pull request open, spec-review",
  },
  {
    kind: "output",
    text: "Human adds spec-approved and agent-ready after review",
  },
  { kind: "command", text: "patchmill run-once --issue 42" },
  { kind: "output", text: "Plan and implementation share the issue branch" },
  {
    kind: "output",
    text: "Ready pull request closes #42; kernel sets agent-done",
  },
];
