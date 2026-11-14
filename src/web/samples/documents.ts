import type { TextBlock } from "../api-types.ts";
export const sampleDocuments: Readonly<Record<string, readonly TextBlock[]>> = {
  "227-spec": [
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Multi-run cost report",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue #227 · Design spec · draft",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Problem",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "The cost table in the pull request comes from ",
        },
        {
          kind: "code",
          text: "pipeline-run-cost.ts",
        },
        {
          kind: "text",
          text: ", which reads only the Pi session of the run that opens the pull request. Earlier runs of the same issue keep their own sessions, but nothing adds them up.",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Design",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "After each run, run-once saves that run's tokens and cost in the issue's run state. Retries already read run state, so nothing new has to find it.",
          },
        ],
        [
          {
            kind: "text",
            text: "The pull request table lists every run, oldest first, then a total.",
          },
        ],
        [
          {
            kind: "text",
            text: "Blocked runs get their own rows, marked as blocked.",
          },
        ],
        [
          {
            kind: "text",
            text: "Runs from before this change show ",
          },
          {
            kind: "emphasis",
            text: "not recorded",
          },
          {
            kind: "text",
            text: " instead of a guess.",
          },
        ],
        [
          {
            kind: "text",
            text: "A retry that stops before Pi starts gets no row.",
          },
        ],
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Example",
        },
      ],
    },
    {
      kind: "table",
      headers: ["Run", "Started", "Outcome", "Tokens", "Cost"],
      rows: [
        ["1", "9 Oct 16:20", "failed", "not recorded", "not recorded"],
        ["2", "10 Oct 08:02", "blocked", "96.1k", "$0.88"],
        ["3", "10 Oct 11:15", "pr-created", "188.4k", "$1.72"],
        ["Total, 2 of 3 runs recorded", "284.5k", "$2.60"],
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Out of scope",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "Costs on the board or in ",
          },
          {
            kind: "code",
            text: "patchmill status",
          },
          {
            kind: "text",
            text: ".",
          },
        ],
        [
          {
            kind: "text",
            text: "Budgets or alerts based on cost.",
          },
        ],
      ],
    },
  ],
  "210-spec": [
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Add frontend design and independent design-review skills to UI workflows",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue #210 · Design spec",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Problem",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "UI changes go through the same planning and review as any other change. Nobody checks the design until a person opens the pull request.",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Design",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "Planning and implementation for UI issues use the frontend-design skill.",
          },
        ],
        [
          {
            kind: "text",
            text: "The spec links a full-page HTML mockup under ",
          },
          {
            kind: "code",
            text: "docs/mockups/",
          },
          {
            kind: "text",
            text: ".",
          },
        ],
        [
          {
            kind: "text",
            text: "After code review, a design reviewer with fresh context compares the result with the mockup and the screenshots.",
          },
        ],
        [
          {
            kind: "text",
            text: "Issues that don't change the UI are not affected.",
          },
        ],
      ],
    },
  ],
  "210-plan": [
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Plan: Add frontend design and independent design-review skills to UI workflows",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue #210 · Implements ",
        },
        {
          kind: "code",
          text: "docs/specs/2026-10-08-design-review-skills-design.md",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Tasks",
        },
      ],
    },
    {
      kind: "list",
      ordered: true,
      items: [
        [
          {
            kind: "text",
            text: "Detect UI issues from labels and changed paths",
          },
        ],
        [
          {
            kind: "text",
            text: "Use frontend-design in planning and implementation",
          },
        ],
        [
          {
            kind: "text",
            text: "Require a mockup link in UI specs",
          },
        ],
        [
          {
            kind: "text",
            text: "Add the design review after code review",
          },
        ],
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Checks",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "Each task adds or updates tests and ends with ",
          },
          {
            kind: "code",
            text: "npm test",
          },
          {
            kind: "text",
            text: " passing.",
          },
        ],
        [
          {
            kind: "text",
            text: "Final validation runs ",
          },
          {
            kind: "code",
            text: "npm run check",
          },
          {
            kind: "text",
            text: ".",
          },
        ],
      ],
    },
  ],
  "276-spec": [
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "run-once drops comment author attribution, so trusted-owner answers are treated as untrusted",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue #276 · Design spec",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Problem",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue context keeps comment bodies but drops their authors. An answer from a trusted owner looks like anyone else's, so run-once treats it as untrusted.",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Design",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "Issue context keeps the author of each comment.",
          },
        ],
        [
          {
            kind: "text",
            text: "Run-once checks authors against the trusted owners in the project config.",
          },
        ],
        [
          {
            kind: "text",
            text: "Retries carry the blocker context, including who answered.",
          },
        ],
        [
          {
            kind: "text",
            text: "Comments from other people stay untrusted.",
          },
        ],
      ],
    },
  ],
  "276-plan": [
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Plan: run-once drops comment author attribution, so trusted-owner answers are treated as untrusted",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue #276 · Implements ",
        },
        {
          kind: "code",
          text: "docs/specs/2026-10-09-comment-author-trust-design.md",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Tasks",
        },
      ],
    },
    {
      kind: "list",
      ordered: true,
      items: [
        [
          {
            kind: "text",
            text: "Keep comment authors in issue context",
          },
        ],
        [
          {
            kind: "text",
            text: "Carry blocker context into retries",
          },
        ],
        [
          {
            kind: "text",
            text: "Check authors against the trusted owners",
          },
        ],
        [
          {
            kind: "text",
            text: "Mark untrusted answers in the prompt",
          },
        ],
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Checks",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "Each task adds or updates tests and ends with ",
          },
          {
            kind: "code",
            text: "npm test",
          },
          {
            kind: "text",
            text: " passing.",
          },
        ],
        [
          {
            kind: "text",
            text: "Final validation runs ",
          },
          {
            kind: "code",
            text: "npm run check",
          },
          {
            kind: "text",
            text: ".",
          },
        ],
      ],
    },
  ],
  "263-spec": [
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Prevent final-validation host gates from using two-minute shorthand timeouts",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue #263 · Design spec",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Problem",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Host gate timeouts accept a bare number such as 2, which Patchmill reads as two minutes. Long final-validation gates are stopped too early.",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Design",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "Every timeout needs a unit, such as ",
          },
          {
            kind: "code",
            text: "90s",
          },
          {
            kind: "text",
            text: ", ",
          },
          {
            kind: "code",
            text: "10m",
          },
          {
            kind: "text",
            text: " or ",
          },
          {
            kind: "code",
            text: "1h",
          },
          {
            kind: "text",
            text: ".",
          },
        ],
        [
          {
            kind: "text",
            text: "A number without a unit is rejected when the config loads. The error names the gate.",
          },
        ],
      ],
    },
  ],
  "263-plan": [
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Plan: Prevent final-validation host gates from using two-minute shorthand timeouts",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue #263 · Implements ",
        },
        {
          kind: "code",
          text: "docs/specs/2026-10-09-host-gate-timeout-units-design.md",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Tasks",
        },
      ],
    },
    {
      kind: "list",
      ordered: true,
      items: [
        [
          {
            kind: "text",
            text: "Add timeout units to host gate config",
          },
        ],
        [
          {
            kind: "text",
            text: "Reject shorthand timeouts",
          },
        ],
        [
          {
            kind: "text",
            text: "Update the config docs and examples",
          },
        ],
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Checks",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "Each task adds or updates tests and ends with ",
          },
          {
            kind: "code",
            text: "npm test",
          },
          {
            kind: "text",
            text: " passing.",
          },
        ],
        [
          {
            kind: "text",
            text: "Final validation runs ",
          },
          {
            kind: "code",
            text: "npm run check",
          },
          {
            kind: "text",
            text: ".",
          },
        ],
      ],
    },
  ],
  "231-spec": [
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Add shared run identity types and the normalized outcome seam",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue #231 · Design spec",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Problem",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Each command builds its own run identity and outcome, so the event ledger can't compare runs.",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Design",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "One run identity type, shared by run-once, triage and status.",
          },
        ],
        [
          {
            kind: "text",
            text: "Outcomes reduce to a small set: ",
          },
          {
            kind: "code",
            text: "pr-created",
          },
          {
            kind: "text",
            text: ", ",
          },
          {
            kind: "code",
            text: "blocked",
          },
          {
            kind: "text",
            text: ", ",
          },
          {
            kind: "code",
            text: "failed",
          },
          {
            kind: "text",
            text: " and ",
          },
          {
            kind: "code",
            text: "cancelled",
          },
          {
            kind: "text",
            text: ".",
          },
        ],
        [
          {
            kind: "text",
            text: "Callers adapt at one seam. Nothing else changes.",
          },
        ],
      ],
    },
  ],
  "231-plan": [
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Plan: Add shared run identity types and the normalized outcome seam",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue #231 · Implements ",
        },
        {
          kind: "code",
          text: "docs/specs/2026-10-05-run-identity-seam-design.md",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Tasks",
        },
      ],
    },
    {
      kind: "list",
      ordered: true,
      items: [
        [
          {
            kind: "text",
            text: "Add the run identity and outcome types",
          },
        ],
        [
          {
            kind: "text",
            text: "Adapt run-once to the seam",
          },
        ],
        [
          {
            kind: "text",
            text: "Adapt triage to the seam",
          },
        ],
        [
          {
            kind: "text",
            text: "Adapt status to the seam",
          },
        ],
        [
          {
            kind: "text",
            text: "Remove the old outcome shapes",
          },
        ],
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Checks",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "Each task adds or updates tests and ends with ",
          },
          {
            kind: "code",
            text: "npm test",
          },
          {
            kind: "text",
            text: " passing.",
          },
        ],
        [
          {
            kind: "text",
            text: "Final validation runs ",
          },
          {
            kind: "code",
            text: "npm run check",
          },
          {
            kind: "text",
            text: ".",
          },
        ],
      ],
    },
  ],
  "173-spec": [
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Show blocked reasons on board cards",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue #173 · Design spec",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Problem",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "A blocked card on the board shows only that it is blocked. To learn why, you have to open the issue.",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Design",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "Blocked cards show the first line of the error under the title.",
          },
        ],
        [
          {
            kind: "text",
            text: "Keyboard focus or hover shows the full reason.",
          },
        ],
        [
          {
            kind: "text",
            text: "On narrow screens, the columns stack and the reason wraps.",
          },
        ],
        [
          {
            kind: "text",
            text: "The reason comes from the run state the board already loads, so the board makes no extra requests.",
          },
        ],
      ],
    },
  ],
  "173-plan": [
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Plan: Show blocked reasons on board cards",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue #173 · Implements ",
        },
        {
          kind: "code",
          text: "docs/specs/2026-10-06-board-blocked-reasons-design.md",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Tasks",
        },
      ],
    },
    {
      kind: "list",
      ordered: true,
      items: [
        [
          {
            kind: "text",
            text: "Add the blocked reason to the board card data",
          },
        ],
        [
          {
            kind: "text",
            text: "Show the first line on blocked cards",
          },
        ],
        [
          {
            kind: "text",
            text: "Show the full reason on focus and hover",
          },
        ],
        [
          {
            kind: "text",
            text: "Stack the columns on narrow screens",
          },
        ],
        [
          {
            kind: "text",
            text: "Add reference screenshots",
          },
        ],
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Checks",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "Each task adds or updates tests and ends with ",
          },
          {
            kind: "code",
            text: "npm test",
          },
          {
            kind: "text",
            text: " passing.",
          },
        ],
        [
          {
            kind: "text",
            text: "Final validation runs ",
          },
          {
            kind: "code",
            text: "npm run check",
          },
          {
            kind: "text",
            text: ".",
          },
        ],
      ],
    },
  ],
  "247-spec": [
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Implementation orchestrator can exhaust spawn budget before an oracle-authorized repair",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue #247 · Design spec",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Problem",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "The orchestrator can use its whole subagent spawn budget before final review. When the oracle authorizes a repair, no slot is left and the run fails.",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Design",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "Reserve one spawn slot for an oracle-authorized repair.",
          },
        ],
        [
          {
            kind: "text",
            text: "Release the slot after landing.",
          },
        ],
        [
          {
            kind: "text",
            text: "Retry once after an authorized repair.",
          },
        ],
      ],
    },
  ],
  "247-plan": [
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Plan: Implementation orchestrator can exhaust spawn budget before an oracle-authorized repair",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue #247 · Implements ",
        },
        {
          kind: "code",
          text: "docs/specs/2026-10-07-spawn-budget-repair-slot-design.md",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Tasks",
        },
      ],
    },
    {
      kind: "list",
      ordered: true,
      items: [
        [
          {
            kind: "text",
            text: "Reserve a repair slot in the spawn budget",
          },
        ],
        [
          {
            kind: "text",
            text: "Release the reserved slot after landing",
          },
        ],
        [
          {
            kind: "text",
            text: "Retry once after an authorized repair",
          },
        ],
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Checks",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "Each task adds or updates tests and ends with ",
          },
          {
            kind: "code",
            text: "npm test",
          },
          {
            kind: "text",
            text: " passing.",
          },
        ],
        [
          {
            kind: "text",
            text: "Final validation runs ",
          },
          {
            kind: "code",
            text: "npm run check",
          },
          {
            kind: "text",
            text: ".",
          },
        ],
      ],
    },
  ],
  "901-spec": [
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Multi-run cost report",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "Issue #227 · Design spec · draft",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Problem",
        },
      ],
    },
    {
      kind: "paragraph",
      content: [
        {
          kind: "text",
          text: "The cost table in the pull request comes from ",
        },
        {
          kind: "code",
          text: "pipeline-run-cost.ts",
        },
        {
          kind: "text",
          text: ", which reads only the Pi session of the run that opens the pull request. Earlier runs of the same issue keep their own sessions, but nothing adds them up.",
        },
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Design",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "After each run, run-once saves that run's tokens and cost in the issue's run state. Retries already read run state, so nothing new has to find it.",
          },
        ],
        [
          {
            kind: "text",
            text: "The pull request table lists every run, oldest first, then a total.",
          },
        ],
        [
          {
            kind: "text",
            text: "Blocked runs get their own rows, marked as blocked.",
          },
        ],
        [
          {
            kind: "text",
            text: "Runs from before this change show ",
          },
          {
            kind: "emphasis",
            text: "not recorded",
          },
          {
            kind: "text",
            text: " instead of a guess.",
          },
        ],
        [
          {
            kind: "text",
            text: "A retry that stops before Pi starts gets no row.",
          },
        ],
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Example",
        },
      ],
    },
    {
      kind: "table",
      headers: ["Run", "Started", "Outcome", "Tokens", "Cost"],
      rows: [
        ["1", "9 Oct 16:20", "failed", "not recorded", "not recorded"],
        ["2", "10 Oct 08:02", "blocked", "96.1k", "$0.88"],
        ["3", "10 Oct 11:15", "pr-created", "188.4k", "$1.72"],
        ["Total, 2 of 3 runs recorded", "284.5k", "$2.60"],
      ],
    },
    {
      kind: "heading",
      content: [
        {
          kind: "text",
          text: "Out of scope",
        },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [
          {
            kind: "text",
            text: "Costs on the board or in ",
          },
          {
            kind: "code",
            text: "patchmill status",
          },
          {
            kind: "text",
            text: ".",
          },
        ],
        [
          {
            kind: "text",
            text: "Budgets or alerts based on cost.",
          },
        ],
      ],
    },
  ],
};
