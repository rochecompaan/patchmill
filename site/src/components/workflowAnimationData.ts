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
      "feature",
      "agent-ready",
      "in-progress",
      "agent-done",
      "plan-approved",
      "priority:high",
    ],
    finalLabels: ["feature", "agent-done", "plan-approved", "priority:high"],
  },
  {
    number: 39,
    title: "Document repo-local Pi auth repair flow",
    initialMeta: "opened by docs-lead · awaiting triage",
    finalMeta: "opened by docs-lead · waiting for plan review",
    labelPool: ["docs", "spec-approved", "plan-review"],
    finalLabels: ["docs", "spec-approved", "plan-review"],
  },
  {
    number: 37,
    title: "Triage flaky setup-test-repo bootstrap",
    initialMeta: "opened by qa-bot · awaiting triage",
    finalMeta: "opened by qa-bot · blocked on provider access",
    labelPool: ["bug", "blocked"],
    finalLabels: ["bug", "blocked"],
  },
  {
    number: 34,
    title: "Shape provider onboarding around team policy",
    initialMeta: "opened by platform-team · awaiting triage",
    finalMeta: "opened by platform-team · needs human decision",
    labelPool: ["enhancement", "needs-info", "priority:medium"],
    finalLabels: ["enhancement", "needs-info", "priority:medium"],
  },
];

export const animationEvents: AnimationEvent[] = [
  {
    type: "terminal-line",
    kind: "command",
    text: "patchmill init",
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
    type: "prompt",
    question: "Which issue provider should Patchmill use?",
    options: [
      "GitHub via gh",
      "Forgejo via tea",
      "Gitea via tea",
      "Codeberg via tea",
    ],
    selected: "GitHub via gh",
    delayAfter: 360,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Provider: GitHub via gh",
    delayAfter: 240,
  },
  {
    type: "prompt",
    question: "Which model should Patchmill use for agent workflows?",
    options: [
      "Claude Sonnet 4",
      "GPT-5",
      "Gemini 2.5 Pro",
      "Local / custom Pi provider",
    ],
    selected: "Claude Sonnet 4",
    delayAfter: 360,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Model: Claude Sonnet 4",
    delayAfter: 180,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Wrote patchmill.config.json",
    delayAfter: 180,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Installed repo-local Patchmill skills",
    delayAfter: 180,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Added .patchmill/ runtime state",
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
    text: "✓ Found 7 open issues",
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
    text: "✓ #42 classified as feature",
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
    labels: ["feature", "agent-ready", "plan-approved", "priority:high"],
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
    text: "✓ #39 classified as docs",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ #39 requires plan review",
    delayAfter: 160,
  },
  {
    type: "issue-labels",
    number: 39,
    labels: ["docs", "spec-approved", "plan-review"],
    meta: "opened by docs-lead · waiting for plan review",
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
    text: "✓ #37 classified as bug",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ #37 blocked on provider access",
    delayAfter: 160,
  },
  {
    type: "issue-labels",
    number: 37,
    labels: ["bug", "blocked"],
    meta: "opened by qa-bot · blocked on provider access",
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
    text: "✓ #34 classified as enhancement",
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
    labels: ["enhancement", "needs-info", "priority:medium"],
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
    labels: ["feature", "in-progress", "plan-approved", "priority:high"],
    meta: "patchmill agent is implementing · worktree active",
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
    text: "✓ Worktree ready at .worktrees/issue-42-visual-proof",
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
    text: "✓ Loaded approved plan",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Implementing visual proof changes",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Running verification",
    delayAfter: 360,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Agent completed implementation.",
    delayAfter: 180,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Preparing handoff for human review...",
    delayAfter: 260,
  },
  {
    type: "issue-labels",
    number: 42,
    labels: ["feature", "agent-done", "plan-approved", "priority:high"],
    meta: "patchmill agent finished · ready for human review",
    delayAfter: 420,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ #42 marked agent-done",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Branch ready for review",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "✓ Visual evidence attached",
    delayAfter: 320,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Patchmill run complete.",
    delayAfter: 160,
  },
  {
    type: "terminal-line",
    kind: "output",
    text: "Next: review the branch, inspect evidence, merge or request changes.",
    delayAfter: 0,
  },
];

export const staticTranscript: TranscriptLine[] = [
  { kind: "command", text: "patchmill init" },
  { kind: "output", text: "Patchmill repository setup" },
  { kind: "question", text: "? Which issue provider should Patchmill use?" },
  { kind: "choice", text: "✓ Provider: GitHub via gh" },
  {
    kind: "question",
    text: "? Which model should Patchmill use for agent workflows?",
  },
  { kind: "choice", text: "✓ Model: Claude Sonnet 4" },
  { kind: "output", text: "✓ Wrote patchmill.config.json" },
  { kind: "output", text: "✓ Installed repo-local Patchmill skills" },
  { kind: "output", text: "✓ Added .patchmill/ runtime state" },
  {
    kind: "command",
    text: "patchmill setup-test-repo --provider github-gh --repo patchmill-demo/team-lunch-poll",
  },
  { kind: "output", text: "✓ Repository created and labels configured" },
  {
    kind: "output",
    text: "✓ Issues #42, #39, #37, and #34 created without labels",
  },
  { kind: "command", text: "patchmill triage" },
  {
    kind: "output",
    text: "✓ Applied feature, docs, bug, enhancement, gate, and priority labels",
  },
  { kind: "command", text: "patchmill run-once" },
  { kind: "output", text: "✓ #42 moved to in-progress while the agent worked" },
  { kind: "output", text: "✓ #42 marked agent-done for human review" },
];
