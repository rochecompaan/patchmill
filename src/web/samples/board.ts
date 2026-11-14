import type { IssueSummary } from "../api-types.ts";
export const sampleBoard: readonly IssueSummary[] = [
  {
    number: 298,
    title: "Show queued issues in patchmill status",
    url: "https://github.com/rochecompaan/patchmill/issues/298",
    labels: [],
    column: "triage",
    status: "none",
    terminal: false,
    phase: null,
    step: null,
    elapsedSeconds: null,
    blockedReason: null,
    pullRequests: [],
    artifacts: [],
  },
  {
    number: 282,
    title: "Patchmill should, at least optionally, create draft pull requests.",
    url: "https://github.com/rochecompaan/patchmill/issues/282",
    labels: [
      {
        name: "needs-info",
        tone: "info",
      },
    ],
    column: "triage",
    status: "none",
    terminal: false,
    phase: null,
    step: null,
    elapsedSeconds: null,
    blockedReason: null,
    pullRequests: [],
    artifacts: [],
  },
  {
    number: 262,
    title:
      "Implementation cleanup blocks on ignored worktree content (regression of the #243 policy)",
    url: "https://github.com/rochecompaan/patchmill/issues/262",
    labels: [
      {
        name: "bug",
        tone: "neutral",
      },
      {
        name: "needs-info",
        tone: "info",
      },
      {
        name: "priority:critical",
        tone: "neutral",
      },
    ],
    column: "triage",
    status: "none",
    terminal: false,
    phase: null,
    step: null,
    elapsedSeconds: null,
    blockedReason: null,
    pullRequests: [],
    artifacts: [],
  },
  {
    number: 227,
    title: "PR run-cost report only covers the final run of a multi-run issue",
    url: "https://github.com/rochecompaan/patchmill/issues/227",
    labels: [
      {
        name: "agent-ready",
        tone: "ready",
      },
    ],
    column: "planning",
    status: "waiting",
    terminal: false,
    phase: "spec",
    step: "create spec",
    elapsedSeconds: 940,
    blockedReason: null,
    pullRequests: [],
    artifacts: [
      {
        id: "spec",
        kind: "spec",
        title: "Multi-run cost report",
      },
    ],
  },
  {
    number: 206,
    title: "Add per-issue planning artifact requirements",
    url: "https://github.com/rochecompaan/patchmill/issues/206",
    labels: [
      {
        name: "agent-ready",
        tone: "ready",
      },
    ],
    column: "ready",
    status: "none",
    terminal: false,
    phase: null,
    step: null,
    elapsedSeconds: null,
    blockedReason: null,
    pullRequests: [],
    artifacts: [],
  },
  {
    number: 233,
    title: "Add the clone-local SQLite event ledger foundation",
    url: "https://github.com/rochecompaan/patchmill/issues/233",
    labels: [
      {
        name: "agent-ready",
        tone: "ready",
      },
    ],
    column: "ready",
    status: "none",
    terminal: false,
    phase: null,
    step: null,
    elapsedSeconds: null,
    blockedReason: null,
    pullRequests: [],
    artifacts: [],
  },
  {
    number: 268,
    title:
      "planning-pr-v1 rejects abbreviated implementation commit OIDs after PR creation",
    url: "https://github.com/rochecompaan/patchmill/issues/268",
    labels: [
      {
        name: "bug",
        tone: "neutral",
      },
      {
        name: "agent-ready",
        tone: "ready",
      },
    ],
    column: "ready",
    status: "none",
    terminal: false,
    phase: null,
    step: null,
    elapsedSeconds: null,
    blockedReason: null,
    pullRequests: [],
    artifacts: [],
  },
  {
    number: 194,
    title:
      "Roll standalone quality checks into CI with baseline-aware ratchets",
    url: "https://github.com/rochecompaan/patchmill/issues/194",
    labels: [
      {
        name: "agent-ready",
        tone: "ready",
      },
    ],
    column: "ready",
    status: "none",
    terminal: false,
    phase: null,
    step: null,
    elapsedSeconds: null,
    blockedReason: null,
    pullRequests: [],
    artifacts: [],
  },
  {
    number: 177,
    title: "Add adversarial spec and plan review to planning",
    url: "https://github.com/rochecompaan/patchmill/issues/177",
    labels: [
      {
        name: "agent-ready",
        tone: "ready",
      },
    ],
    column: "ready",
    status: "none",
    terminal: false,
    phase: null,
    step: null,
    elapsedSeconds: null,
    blockedReason: null,
    pullRequests: [],
    artifacts: [],
  },
  {
    number: 250,
    title:
      "run-once: selection diverges from --dry-run and review-pending planning work starves actionable issues",
    url: "https://github.com/rochecompaan/patchmill/issues/250",
    labels: [
      {
        name: "agent-ready",
        tone: "ready",
      },
    ],
    column: "planning",
    status: "working",
    terminal: false,
    phase: "brainstorm",
    step: "brainstorm",
    elapsedSeconds: 372,
    blockedReason: null,
    pullRequests: [],
    artifacts: [],
  },
  {
    number: 210,
    title:
      "Add frontend design and independent design-review skills to UI workflows",
    url: "https://github.com/rochecompaan/patchmill/issues/210",
    labels: [
      {
        name: "agent-ready",
        tone: "ready",
      },
      {
        name: "priority:high",
        tone: "neutral",
      },
    ],
    column: "review",
    status: "idle",
    terminal: false,
    phase: "plan-review",
    step: "plan review",
    elapsedSeconds: 9660,
    blockedReason: null,
    pullRequests: [
      {
        number: 302,
        label: "Spec PR #302",
        url: "https://github.com/rochecompaan/patchmill/pull/302",
        state: "merged",
        kind: "spec",
      },
      {
        number: 301,
        label: "Plan PR #301",
        url: "https://github.com/rochecompaan/patchmill/pull/301",
        state: "open",
        kind: "plan",
      },
    ],
    artifacts: [
      {
        id: "spec",
        kind: "spec",
        title:
          "Add frontend design and independent design-review skills to UI workflows",
      },
      {
        id: "plan",
        kind: "plan",
        title:
          "Plan: Add frontend design and independent design-review skills to UI workflows",
      },
      {
        id: "mockup",
        kind: "mockup",
        title: "Design review comment",
      },
      {
        id: "diagram",
        kind: "diagram",
        title: "Design review in UI workflows",
      },
    ],
  },
  {
    number: 276,
    title:
      "run-once drops comment author attribution, so trusted-owner answers are treated as untrusted",
    url: "https://github.com/rochecompaan/patchmill/issues/276",
    labels: [
      {
        name: "bug",
        tone: "neutral",
      },
      {
        name: "agent-ready",
        tone: "ready",
      },
    ],
    column: "implementing",
    status: "working",
    terminal: false,
    phase: "implement",
    step: "implement task 2/4 carry blocker context into retries",
    elapsedSeconds: 6720,
    blockedReason: null,
    pullRequests: [],
    artifacts: [
      {
        id: "spec",
        kind: "spec",
        title:
          "run-once drops comment author attribution, so trusted-owner answers are treated as untrusted",
      },
      {
        id: "plan",
        kind: "plan",
        title:
          "Plan: run-once drops comment author attribution, so trusted-owner answers are treated as untrusted",
      },
      {
        id: "diagram",
        kind: "diagram",
        title: "Comment authors in run-once",
      },
    ],
  },
  {
    number: 263,
    title:
      "Prevent final-validation host gates from using two-minute shorthand timeouts",
    url: "https://github.com/rochecompaan/patchmill/issues/263",
    labels: [
      {
        name: "bug",
        tone: "neutral",
      },
      {
        name: "agent-ready",
        tone: "ready",
      },
    ],
    column: "implementing",
    status: "working",
    terminal: true,
    phase: "implement",
    step: "implement task 2/3 reject shorthand timeouts",
    elapsedSeconds: 1448,
    blockedReason: null,
    pullRequests: [],
    artifacts: [
      {
        id: "spec",
        kind: "spec",
        title:
          "Prevent final-validation host gates from using two-minute shorthand timeouts",
      },
      {
        id: "plan",
        kind: "plan",
        title:
          "Plan: Prevent final-validation host gates from using two-minute shorthand timeouts",
      },
      {
        id: "diagram",
        kind: "diagram",
        title: "Host gate timeouts",
      },
    ],
  },
  {
    number: 231,
    title: "Add shared run identity types and the normalized outcome seam",
    url: "https://github.com/rochecompaan/patchmill/issues/231",
    labels: [
      {
        name: "agent-ready",
        tone: "ready",
      },
    ],
    column: "code",
    status: "done",
    terminal: false,
    phase: "code-review",
    step: "final result pr-created",
    elapsedSeconds: 8280,
    blockedReason: null,
    pullRequests: [
      {
        number: 300,
        label: "PR #300",
        url: "https://github.com/rochecompaan/patchmill/pull/300",
        state: "open",
        kind: "implementation",
      },
    ],
    artifacts: [
      {
        id: "spec",
        kind: "spec",
        title: "Add shared run identity types and the normalized outcome seam",
      },
      {
        id: "plan",
        kind: "plan",
        title:
          "Plan: Add shared run identity types and the normalized outcome seam",
      },
    ],
  },
  {
    number: 173,
    title: "Show blocked reasons on board cards",
    url: "https://github.com/rochecompaan/patchmill/issues/173",
    labels: [
      {
        name: "agent-ready",
        tone: "ready",
      },
      {
        name: "priority:medium",
        tone: "neutral",
      },
    ],
    column: "code",
    status: "done",
    terminal: false,
    phase: "code-review",
    step: "final result pr-created",
    elapsedSeconds: 11100,
    blockedReason: null,
    pullRequests: [
      {
        number: 297,
        label: "PR #297",
        url: "https://github.com/rochecompaan/patchmill/pull/297",
        state: "open",
        kind: "implementation",
      },
    ],
    artifacts: [
      {
        id: "spec",
        kind: "spec",
        title: "Show blocked reasons on board cards",
      },
      {
        id: "plan",
        kind: "plan",
        title: "Plan: Show blocked reasons on board cards",
      },
      {
        id: "mockup",
        kind: "mockup",
        title: "Board: blocked reasons",
      },
      {
        id: "shots",
        kind: "shots",
        title: "Screenshots",
      },
    ],
  },
  {
    number: 247,
    title:
      "Implementation orchestrator can exhaust spawn budget before an oracle-authorized repair",
    url: "https://github.com/rochecompaan/patchmill/issues/247",
    labels: [
      {
        name: "bug",
        tone: "neutral",
      },
      {
        name: "agent-ready",
        tone: "ready",
      },
      {
        name: "priority:high",
        tone: "neutral",
      },
    ],
    column: "blocked",
    status: "blocked",
    terminal: false,
    phase: "implement",
    step: "final review and landing",
    elapsedSeconds: 11520,
    blockedReason: "Final validation failed",
    pullRequests: [],
    artifacts: [
      {
        id: "spec",
        kind: "spec",
        title:
          "Implementation orchestrator can exhaust spawn budget before an oracle-authorized repair",
      },
      {
        id: "plan",
        kind: "plan",
        title:
          "Plan: Implementation orchestrator can exhaust spawn budget before an oracle-authorized repair",
      },
    ],
  },
  {
    number: 232,
    title: "Support graceful cancellation in the run-once workflow",
    url: "https://github.com/rochecompaan/patchmill/issues/232",
    labels: [
      {
        name: "blocked",
        tone: "blocked",
      },
    ],
    column: "blocked",
    status: "none",
    terminal: false,
    phase: null,
    step: null,
    elapsedSeconds: null,
    blockedReason: null,
    pullRequests: [],
    artifacts: [],
  },
  {
    number: 234,
    title: "Normalize and ingest Pi usage into the event ledger",
    url: "https://github.com/rochecompaan/patchmill/issues/234",
    labels: [
      {
        name: "blocked",
        tone: "blocked",
      },
    ],
    column: "blocked",
    status: "none",
    terminal: false,
    phase: null,
    step: null,
    elapsedSeconds: null,
    blockedReason: null,
    pullRequests: [],
    artifacts: [],
  },
  {
    number: 236,
    title: "Add the continuous coordinator core for patchmill run",
    url: "https://github.com/rochecompaan/patchmill/issues/236",
    labels: [
      {
        name: "blocked",
        tone: "blocked",
      },
    ],
    column: "blocked",
    status: "none",
    terminal: false,
    phase: null,
    step: null,
    elapsedSeconds: null,
    blockedReason: null,
    pullRequests: [],
    artifacts: [],
  },
  {
    number: 901,
    title: "Sample paused run: cumulative PR cost report",
    url: "/#/issue/901",
    labels: [
      {
        name: "agent-ready",
        tone: "ready",
      },
    ],
    column: "planning",
    status: "paused",
    terminal: false,
    phase: "spec",
    step: "create spec",
    elapsedSeconds: 1685,
    blockedReason: null,
    pullRequests: [],
    artifacts: [
      {
        id: "spec",
        kind: "spec",
        title: "Multi-run cost report",
      },
    ],
  },
];
