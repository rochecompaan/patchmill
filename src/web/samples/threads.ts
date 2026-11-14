import type { IssueDetail } from "../api-types.ts";
export const sampleThreads: Readonly<
  Record<string, Pick<IssueDetail, "participants" | "thread" | "finalUsage">>
> = {
  "298": {
    participants: [],
    thread: [],
    finalUsage: null,
  },
  "282": {
    participants: [],
    thread: [],
    finalUsage: null,
  },
  "262": {
    participants: [],
    thread: [],
    finalUsage: null,
  },
  "227": {
    participants: ["roche", "Naledi"],
    thread: [
      {
        id: "227-0",
        at: "2026-11-13T09:12:00.000Z",
        kind: "divider",
        tone: "neutral",
        text: "roche started planning",
      },
      {
        id: "227-1",
        at: null,
        kind: "step",
        number: 1,
        label: "claim issue",
      },
      {
        id: "227-2",
        at: null,
        kind: "usage",
        taskTokens: 0,
        totalTokens: 0,
        elapsedSeconds: 3,
      },
      {
        id: "227-3",
        at: null,
        kind: "step",
        number: 2,
        label: "brainstorm",
      },
      {
        id: "227-4",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command: "gh issue view 227 --json title,body,comments",
        },
        result:
          "title: PR run-cost report only covers the final run of a multi-run issue\nbody:  When an issue needs several run-once invocations, the cost table in the\n       pull request only reflects the last one…",
        state: "completed",
      },
      {
        id: "227-5",
        at: null,
        kind: "tool",
        name: "read",
        arguments: {
          path: "src/cli/commands/run-once/pipeline-run-cost.ts",
        },
        result: "212 lines",
        state: "completed",
      },
      {
        id: "227-6",
        at: null,
        kind: "tool",
        name: "grep",
        arguments: {
          pattern: "runCost",
          path: "src",
        },
        result: "14 matches in 6 files",
        state: "completed",
      },
      {
        id: "227-7",
        at: "2026-11-13T09:14:00.000Z",
        kind: "message",
        author: "agent",
        role: "agent",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "I read #227 and the run-cost code. The cost table in the pull request comes from ",
              },
              {
                kind: "code",
                text: "pipeline-run-cost.ts",
              },
              {
                kind: "text",
                text: ", which only reads the Pi session of the run that opens the pull request. Earlier runs keep their own sessions, but nothing adds them up.",
              },
            ],
          },
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "First question: what should the table show?",
              },
            ],
          },
          {
            kind: "list",
            ordered: true,
            items: [
              [
                {
                  kind: "strong",
                  text: "One total",
                },
                {
                  kind: "text",
                  text: " for the whole issue.",
                },
              ],
              [
                {
                  kind: "strong",
                  text: "One row per run",
                },
                {
                  kind: "text",
                  text: ", plus a total.",
                },
              ],
            ],
          },
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "I recommend B, so a reviewer can see which run made the issue expensive.",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "227-8",
        at: "2026-11-13T09:16:00.000Z",
        kind: "message",
        author: "roche",
        role: "person",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "B. Keep it to one line per run.",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "227-9",
        at: "2026-11-13T09:17:00.000Z",
        kind: "message",
        author: "Naledi",
        role: "person",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Count the blocked runs too. That's usually where the money goes.",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "227-10",
        at: "2026-11-13T09:17:00.000Z",
        kind: "message",
        author: "agent",
        role: "agent",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Good point, Naledi. Blocked runs get their own rows, marked as blocked.",
              },
            ],
          },
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Next question: where should each run's cost be saved?",
              },
            ],
          },
          {
            kind: "list",
            ordered: true,
            items: [
              [
                {
                  kind: "strong",
                  text: "In the issue's run state",
                },
                {
                  kind: "text",
                  text: ", which already survives retries.",
                },
              ],
              [
                {
                  kind: "strong",
                  text: "In a new file per run",
                },
                {
                  kind: "text",
                  text: " under ",
                },
                {
                  kind: "code",
                  text: ".patchmill/runs/",
                },
                {
                  kind: "text",
                  text: ".",
                },
              ],
            ],
          },
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "I recommend A. Retries already read run state, so nothing new has to find the file.",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "227-11",
        at: "2026-11-13T09:19:00.000Z",
        kind: "message",
        author: "roche",
        role: "person",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "A",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "227-12",
        at: "2026-11-13T09:20:00.000Z",
        kind: "message",
        author: "agent",
        role: "agent",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "That's everything I need. Here is the design:",
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
                  text: "After each run, run-once saves that run's tokens and cost in the issue's run state.",
                },
              ],
              [
                {
                  kind: "text",
                  text: "The pull request table lists every run: start time, result, tokens and cost.",
                },
              ],
              [
                {
                  kind: "text",
                  text: "Blocked runs are included and marked.",
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
                  text: ".",
                },
              ],
            ],
          },
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Shall I write the spec?",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "227-13",
        at: "2026-11-13T09:21:00.000Z",
        kind: "message",
        author: "roche",
        role: "person",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Looks good, go ahead.",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "227-14",
        at: null,
        kind: "tool",
        name: "patchmill_advance",
        arguments: {
          to: "create spec",
          reason: "roche agreed to the design",
        },
        result: "ok: next step is create spec",
        state: "completed",
      },
      {
        id: "227-15",
        at: "2026-11-13T09:21:00.000Z",
        kind: "divider",
        tone: "advance",
        text: "Design agreed. Writing the spec.",
      },
      {
        id: "227-16",
        at: null,
        kind: "usage",
        taskTokens: 18200,
        totalTokens: 18200,
        elapsedSeconds: 554,
      },
      {
        id: "227-17",
        at: null,
        kind: "step",
        number: 3,
        label: "create spec",
      },
      {
        id: "227-18",
        at: null,
        kind: "tool",
        name: "read",
        arguments: {
          path: "src/run-state/issue-run-state.ts",
        },
        result: "148 lines",
        state: "completed",
      },
      {
        id: "227-19",
        at: null,
        kind: "tool",
        name: "write",
        arguments: {
          path: "docs/specs/2026-10-10-multi-run-cost-report-design.md",
        },
        result: "wrote 96 lines",
        state: "completed",
      },
      {
        id: "227-20",
        at: null,
        kind: "artifact",
        artifactId: "spec",
        text: "Spec draft written",
      },
      {
        id: "227-21",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command:
            "npx prettier --check docs/specs/2026-10-10-multi-run-cost-report-design.md",
        },
        result: "All matched files use Prettier code style!",
        state: "completed",
      },
      {
        id: "227-22",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command:
            'git commit -m "docs(spec): add multi-run cost report design"',
        },
        result:
          "[agent/issue-227-spec 3e1a9c0] docs(spec): add multi-run cost report design\n 1 file changed, 96 insertions(+)",
        state: "completed",
      },
      {
        id: "227-23",
        at: "2026-11-13T09:27:00.000Z",
        kind: "message",
        author: "agent",
        role: "agent",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "The spec draft is ready: ",
              },
              {
                kind: "code",
                text: "docs/specs/2026-10-10-multi-run-cost-report-design.md",
              },
              {
                kind: "text",
                text: ". Three things worth checking:",
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
                  text: "The table has one row per run, oldest first.",
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
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Any changes, or should I open the spec pull request?",
              },
            ],
          },
        ],
        note: null,
      },
    ],
    finalUsage: null,
  },
  "206": {
    participants: [],
    thread: [],
    finalUsage: null,
  },
  "233": {
    participants: [],
    thread: [],
    finalUsage: null,
  },
  "268": {
    participants: [],
    thread: [],
    finalUsage: null,
  },
  "194": {
    participants: [],
    thread: [],
    finalUsage: null,
  },
  "177": {
    participants: [],
    thread: [],
    finalUsage: null,
  },
  "250": {
    participants: ["Naledi"],
    thread: [
      {
        id: "250-0",
        at: "2026-11-13T11:02:00.000Z",
        kind: "divider",
        tone: "neutral",
        text: "Naledi started planning",
      },
      {
        id: "250-1",
        at: null,
        kind: "step",
        number: 1,
        label: "claim issue",
      },
      {
        id: "250-2",
        at: null,
        kind: "usage",
        taskTokens: 0,
        totalTokens: 0,
        elapsedSeconds: 2,
      },
      {
        id: "250-3",
        at: null,
        kind: "step",
        number: 2,
        label: "brainstorm",
      },
      {
        id: "250-4",
        at: null,
        kind: "tool",
        name: "read",
        arguments: {
          path: "src/cli/commands/run-once/pipeline-selection.ts",
        },
        result: "264 lines",
        state: "completed",
      },
      {
        id: "250-5",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command: "patchmill run-once --dry-run",
        },
        result: "would select #250 (review-pending planning work is skipped)",
        state: "completed",
      },
      {
        id: "250-6",
        at: "2026-11-13T11:05:00.000Z",
        kind: "message",
        author: "agent",
        role: "agent",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "I compared the two selection paths. ",
              },
              {
                kind: "code",
                text: "--dry-run",
              },
              {
                kind: "text",
                text: " skips issues whose planning pull request is in review, but a real run picks them up again and then waits on them.",
              },
            ],
          },
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Should both skip review-pending issues, or should both pick them only when nothing else is ready?",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "250-7",
        at: "2026-11-13T11:07:00.000Z",
        kind: "message",
        author: "Naledi",
        role: "person",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Skip them in both. A review can take days.",
              },
            ],
          },
        ],
        note: null,
      },
    ],
    finalUsage: null,
  },
  "210": {
    participants: [],
    thread: [
      {
        id: "210-0",
        at: null,
        kind: "earlier",
        text: "Brainstorm, spec, spec review and plan · 5 steps",
      },
      {
        id: "210-1",
        at: null,
        kind: "artifact",
        artifactId: "plan",
        text: "Plan draft written",
      },
      {
        id: "210-2",
        at: null,
        kind: "artifact",
        artifactId: "diagram",
        text: "Show-me diagram written",
      },
      {
        id: "210-3",
        at: "2026-11-13T08:50:00.000Z",
        kind: "message",
        author: "roche",
        role: "person",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "The plan looks right. Open it.",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "210-4",
        at: null,
        kind: "tool",
        name: "patchmill_advance",
        arguments: {
          to: "open plan pull request",
          reason: "roche approved the plan",
        },
        result: "ok: next step is plan review",
        state: "completed",
      },
      {
        id: "210-5",
        at: "2026-11-13T08:50:00.000Z",
        kind: "divider",
        tone: "advance",
        text: "Plan approved. Opening the pull request.",
      },
      {
        id: "210-6",
        at: null,
        kind: "step",
        number: 6,
        label: "plan review",
      },
      {
        id: "210-7",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command:
            'gh pr create --title "plan: design skills for UI workflows (#210)" --base main',
        },
        result: "https://github.com/rochecompaan/patchmill/pull/301",
        state: "completed",
      },
      {
        id: "210-8",
        at: "2026-11-13T08:51:00.000Z",
        kind: "message",
        author: "agent",
        role: "agent",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Plan PR ",
              },
              {
                kind: "link",
                text: "#301",
                href: "https://github.com/rochecompaan/patchmill/pull/301",
              },
              {
                kind: "text",
                text: " is open. I'm watching it. When it merges, I'll start implementation straight away.",
              },
            ],
          },
        ],
        note: null,
      },
    ],
    finalUsage: null,
  },
  "276": {
    participants: ["roche"],
    thread: [
      {
        id: "276-0",
        at: null,
        kind: "earlier",
        text: "Brainstorm, spec, plan and plan review · 6 steps",
      },
      {
        id: "276-1",
        at: "2026-11-13T10:41:00.000Z",
        kind: "divider",
        tone: "advance",
        text: "Plan PR #296 merged by roche. Starting implementation.",
      },
      {
        id: "276-2",
        at: null,
        kind: "step",
        number: 7,
        label: "implement task 1/4 keep comment authors in issue context",
      },
      {
        id: "276-3",
        at: null,
        kind: "tool",
        name: "read",
        arguments: {
          path: "src/issues/issue-context.ts",
        },
        result: "188 lines",
        state: "completed",
      },
      {
        id: "276-4",
        at: null,
        kind: "tool",
        name: "edit",
        arguments: {
          path: "src/issues/issue-context.ts",
        },
        result: "3 edits applied",
        state: "completed",
      },
      {
        id: "276-5",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command: "npm test -- src/issues/issue-context.test.ts",
        },
        result: "✓ 14 tests passed",
        state: "completed",
      },
      {
        id: "276-6",
        at: null,
        kind: "usage",
        taskTokens: 22900,
        totalTokens: 164000,
        elapsedSeconds: 5940,
      },
      {
        id: "276-7",
        at: null,
        kind: "step",
        number: 8,
        label: "implement task 2/4 carry blocker context into retries",
      },
      {
        id: "276-8",
        at: null,
        kind: "tool",
        name: "subagent",
        arguments: {
          agent: "worker",
          model: "claude-sonnet-5-5",
        },
        result: "worker started in the issue worktree",
        state: "completed",
      },
      {
        id: "276-9",
        at: null,
        kind: "tool",
        name: "read",
        arguments: {
          path: "src/cli/commands/run-once/pipeline-recovery.ts",
        },
        result: "301 lines",
        state: "completed",
      },
      {
        id: "276-10",
        at: "2026-11-13T10:58:00.000Z",
        kind: "message",
        author: "roche",
        role: "person",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Heads-up: trusted owners live in ",
              },
              {
                kind: "code",
                text: ".patchmill/config.json",
              },
              {
                kind: "text",
                text: " under ",
              },
              {
                kind: "code",
                text: "trustedAuthors",
              },
              {
                kind: "text",
                text: ", not in an environment variable.",
              },
            ],
          },
        ],
        note: "Sent while the agent was working.",
      },
      {
        id: "276-11",
        at: "2026-11-13T10:59:00.000Z",
        kind: "message",
        author: "agent",
        role: "agent",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Thanks. I'll read trusted owners from ",
              },
              {
                kind: "code",
                text: "trustedAuthors",
              },
              {
                kind: "text",
                text: " in the config.",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "276-12",
        at: null,
        kind: "tool",
        name: "read",
        arguments: {
          path: ".patchmill/config.json",
        },
        result: "42 lines",
        state: "completed",
      },
      {
        id: "276-13",
        at: null,
        kind: "tool",
        name: "edit",
        arguments: {
          path: "src/cli/commands/run-once/pipeline-recovery.ts",
        },
        result: null,
        state: "running",
      },
    ],
    finalUsage: null,
  },
  "263": {
    participants: [],
    thread: [
      {
        id: "263-0",
        at: "2026-11-13T10:22:00.000Z",
        kind: "divider",
        tone: "neutral",
        text: "roche started this run in a terminal",
      },
      {
        id: "263-1",
        at: null,
        kind: "step",
        number: 1,
        label: "select issue",
      },
      {
        id: "263-2",
        at: null,
        kind: "usage",
        taskTokens: 0,
        totalTokens: 0,
        elapsedSeconds: 2,
      },
      {
        id: "263-3",
        at: null,
        kind: "step",
        number: 2,
        label: "claim issue",
      },
      {
        id: "263-4",
        at: null,
        kind: "usage",
        taskTokens: 0,
        totalTokens: 0,
        elapsedSeconds: 4,
      },
      {
        id: "263-5",
        at: null,
        kind: "step",
        number: 3,
        label: "use existing plan",
      },
      {
        id: "263-6",
        at: null,
        kind: "artifact",
        artifactId: "plan",
        text: "Using the merged plan",
      },
      {
        id: "263-7",
        at: null,
        kind: "usage",
        taskTokens: 1200,
        totalTokens: 1200,
        elapsedSeconds: 31,
      },
      {
        id: "263-8",
        at: null,
        kind: "step",
        number: 4,
        label: "implement task 1/3 add timeout units to host gate config",
      },
      {
        id: "263-9",
        at: null,
        kind: "tool",
        name: "read",
        arguments: {
          path: "src/gates/host-gates.ts",
        },
        result: "176 lines",
        state: "completed",
      },
      {
        id: "263-10",
        at: null,
        kind: "tool",
        name: "edit",
        arguments: {
          path: "src/gates/host-gates.ts",
        },
        result: "4 edits applied",
        state: "completed",
      },
      {
        id: "263-11",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command: "npm test -- src/gates",
        },
        result: "✓ 31 tests passed",
        state: "completed",
      },
      {
        id: "263-12",
        at: null,
        kind: "usage",
        taskTokens: 19400,
        totalTokens: 20600,
        elapsedSeconds: 890,
      },
      {
        id: "263-13",
        at: null,
        kind: "step",
        number: 5,
        label: "implement task 2/3 reject shorthand timeouts",
      },
      {
        id: "263-14",
        at: null,
        kind: "tool",
        name: "subagent",
        arguments: {
          agent: "worker",
          model: "claude-sonnet-5-5",
        },
        result: "worker started in the issue worktree",
        state: "completed",
      },
      {
        id: "263-15",
        at: null,
        kind: "tool",
        name: "edit",
        arguments: {
          path: "src/gates/timeout-parsing.ts",
        },
        result: "2 edits applied",
        state: "completed",
      },
      {
        id: "263-16",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command: "npm run typecheck",
        },
        result: null,
        state: "running",
      },
    ],
    finalUsage: null,
  },
  "231": {
    participants: [],
    thread: [
      {
        id: "231-0",
        at: null,
        kind: "earlier",
        text: "Brainstorm, spec, plan and 5 tasks · 8 steps",
      },
      {
        id: "231-1",
        at: null,
        kind: "step",
        number: 9,
        label: "final review and landing",
      },
      {
        id: "231-2",
        at: null,
        kind: "tool",
        name: "subagent",
        arguments: {
          agent: "reviewer",
          model: "claude-opus-5-5",
        },
        result: "review passed with no findings",
        state: "completed",
      },
      {
        id: "231-3",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command: "npm run check",
        },
        result: "✓ lint  ✓ typecheck  ✓ test",
        state: "completed",
      },
      {
        id: "231-4",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command: 'gh pr create --title "feat: #231" --base main',
        },
        result: "https://github.com/rochecompaan/patchmill/pull/300",
        state: "completed",
      },
      {
        id: "231-5",
        at: null,
        kind: "usage",
        taskTokens: 64000,
        totalTokens: 412000,
        elapsedSeconds: 8280,
      },
      {
        id: "231-6",
        at: null,
        kind: "step",
        number: 10,
        label: "final result pr-created",
      },
      {
        id: "231-7",
        at: "2026-11-13T12:40:00.000Z",
        kind: "divider",
        tone: "advance",
        text: "Implementation PR #300 opened. The run has finished.",
      },
    ],
    finalUsage: {
      tokens: 412000,
      cost: {
        amount: "3.84",
        currency: "USD",
      },
    },
  },
  "173": {
    participants: [],
    thread: [
      {
        id: "173-0",
        at: null,
        kind: "earlier",
        text: "Brainstorm, spec, plan and 5 tasks · 8 steps",
      },
      {
        id: "173-1",
        at: null,
        kind: "step",
        number: 9,
        label: "final review and landing",
      },
      {
        id: "173-2",
        at: null,
        kind: "tool",
        name: "subagent",
        arguments: {
          agent: "reviewer",
          model: "claude-opus-5-5",
        },
        result: "review passed with no findings",
        state: "completed",
      },
      {
        id: "173-3",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command: "npm run check",
        },
        result: "✓ lint  ✓ typecheck  ✓ test",
        state: "completed",
      },
      {
        id: "173-4",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command: 'gh pr create --title "feat: #173" --base main',
        },
        result: "https://github.com/rochecompaan/patchmill/pull/297",
        state: "completed",
      },
      {
        id: "173-5",
        at: null,
        kind: "progress",
        text: "validated 3 committed visual evidence reference screenshots",
      },
      {
        id: "173-6",
        at: null,
        kind: "artifact",
        artifactId: "shots",
        text: "Screenshots attached as visual proof",
      },
      {
        id: "173-7",
        at: null,
        kind: "usage",
        taskTokens: 64000,
        totalTokens: 571000,
        elapsedSeconds: 11100,
      },
      {
        id: "173-8",
        at: null,
        kind: "step",
        number: 10,
        label: "final result pr-created",
      },
      {
        id: "173-9",
        at: "2026-11-13T12:40:00.000Z",
        kind: "divider",
        tone: "advance",
        text: "Implementation PR #297 opened. The run has finished.",
      },
    ],
    finalUsage: {
      tokens: 571000,
      cost: {
        amount: "5.10",
        currency: "USD",
      },
    },
  },
  "247": {
    participants: [],
    thread: [
      {
        id: "247-0",
        at: null,
        kind: "earlier",
        text: "Brainstorm, spec, plan and 4 tasks · 9 steps",
      },
      {
        id: "247-1",
        at: null,
        kind: "step",
        number: 10,
        label: "final review and landing",
      },
      {
        id: "247-2",
        at: null,
        kind: "tool",
        name: "subagent",
        arguments: {
          agent: "reviewer",
          model: "claude-opus-5-5",
        },
        result: "review: 1 important finding, fixed in 9c41d2e",
        state: "completed",
      },
      {
        id: "247-3",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command: "npm test",
        },
        result: "3 failing, 1,284 passing",
        state: "failed",
      },
      {
        id: "247-4",
        at: "2026-11-13T13:47:00.000Z",
        kind: "divider",
        tone: "blocked",
        text: "Run stopped by an error.",
      },
      {
        id: "247-5",
        at: null,
        kind: "error",
        title: "Final validation failed",
        text: "npm test exited with code 1.\n  ✗ spawn budget › reserves a slot for oracle-authorized repairs\n  ✗ spawn budget › releases the reserved slot after landing\n  ✗ orchestrator › retries once after an authorized repair\n\nPatchmill stopped the run and kept the worktree.\nFix the cause, then click Retry.",
      },
    ],
    finalUsage: null,
  },
  "232": {
    participants: [],
    thread: [],
    finalUsage: null,
  },
  "234": {
    participants: [],
    thread: [],
    finalUsage: null,
  },
  "236": {
    participants: [],
    thread: [],
    finalUsage: null,
  },
  "901": {
    participants: ["roche", "Naledi"],
    thread: [
      {
        id: "901-0",
        at: "2026-11-13T09:12:00.000Z",
        kind: "divider",
        tone: "neutral",
        text: "roche started planning",
      },
      {
        id: "901-1",
        at: null,
        kind: "step",
        number: 1,
        label: "claim issue",
      },
      {
        id: "901-2",
        at: null,
        kind: "usage",
        taskTokens: 0,
        totalTokens: 0,
        elapsedSeconds: 3,
      },
      {
        id: "901-3",
        at: null,
        kind: "step",
        number: 2,
        label: "brainstorm",
      },
      {
        id: "901-4",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command: "gh issue view 227 --json title,body,comments",
        },
        result:
          "title: PR run-cost report only covers the final run of a multi-run issue\nbody:  When an issue needs several run-once invocations, the cost table in the\n       pull request only reflects the last one…",
        state: "completed",
      },
      {
        id: "901-5",
        at: null,
        kind: "tool",
        name: "read",
        arguments: {
          path: "src/cli/commands/run-once/pipeline-run-cost.ts",
        },
        result: "212 lines",
        state: "completed",
      },
      {
        id: "901-6",
        at: null,
        kind: "tool",
        name: "grep",
        arguments: {
          pattern: "runCost",
          path: "src",
        },
        result: "14 matches in 6 files",
        state: "completed",
      },
      {
        id: "901-7",
        at: "2026-11-13T09:14:00.000Z",
        kind: "message",
        author: "agent",
        role: "agent",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "I read #227 and the run-cost code. The cost table in the pull request comes from ",
              },
              {
                kind: "code",
                text: "pipeline-run-cost.ts",
              },
              {
                kind: "text",
                text: ", which only reads the Pi session of the run that opens the pull request. Earlier runs keep their own sessions, but nothing adds them up.",
              },
            ],
          },
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "First question: what should the table show?",
              },
            ],
          },
          {
            kind: "list",
            ordered: true,
            items: [
              [
                {
                  kind: "strong",
                  text: "One total",
                },
                {
                  kind: "text",
                  text: " for the whole issue.",
                },
              ],
              [
                {
                  kind: "strong",
                  text: "One row per run",
                },
                {
                  kind: "text",
                  text: ", plus a total.",
                },
              ],
            ],
          },
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "I recommend B, so a reviewer can see which run made the issue expensive.",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "901-8",
        at: "2026-11-13T09:16:00.000Z",
        kind: "message",
        author: "roche",
        role: "person",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "B. Keep it to one line per run.",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "901-9",
        at: "2026-11-13T09:17:00.000Z",
        kind: "message",
        author: "Naledi",
        role: "person",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Count the blocked runs too. That's usually where the money goes.",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "901-10",
        at: "2026-11-13T09:17:00.000Z",
        kind: "message",
        author: "agent",
        role: "agent",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Good point, Naledi. Blocked runs get their own rows, marked as blocked.",
              },
            ],
          },
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Next question: where should each run's cost be saved?",
              },
            ],
          },
          {
            kind: "list",
            ordered: true,
            items: [
              [
                {
                  kind: "strong",
                  text: "In the issue's run state",
                },
                {
                  kind: "text",
                  text: ", which already survives retries.",
                },
              ],
              [
                {
                  kind: "strong",
                  text: "In a new file per run",
                },
                {
                  kind: "text",
                  text: " under ",
                },
                {
                  kind: "code",
                  text: ".patchmill/runs/",
                },
                {
                  kind: "text",
                  text: ".",
                },
              ],
            ],
          },
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "I recommend A. Retries already read run state, so nothing new has to find the file.",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "901-11",
        at: "2026-11-13T09:19:00.000Z",
        kind: "message",
        author: "roche",
        role: "person",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "A",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "901-12",
        at: "2026-11-13T09:20:00.000Z",
        kind: "message",
        author: "agent",
        role: "agent",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "That's everything I need. Here is the design:",
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
                  text: "After each run, run-once saves that run's tokens and cost in the issue's run state.",
                },
              ],
              [
                {
                  kind: "text",
                  text: "The pull request table lists every run: start time, result, tokens and cost.",
                },
              ],
              [
                {
                  kind: "text",
                  text: "Blocked runs are included and marked.",
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
                  text: ".",
                },
              ],
            ],
          },
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Shall I write the spec?",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "901-13",
        at: "2026-11-13T09:21:00.000Z",
        kind: "message",
        author: "roche",
        role: "person",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Looks good, go ahead.",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "901-14",
        at: null,
        kind: "tool",
        name: "patchmill_advance",
        arguments: {
          to: "create spec",
          reason: "roche agreed to the design",
        },
        result: "ok: next step is create spec",
        state: "completed",
      },
      {
        id: "901-15",
        at: "2026-11-13T09:21:00.000Z",
        kind: "divider",
        tone: "advance",
        text: "Design agreed. Writing the spec.",
      },
      {
        id: "901-16",
        at: null,
        kind: "usage",
        taskTokens: 18200,
        totalTokens: 18200,
        elapsedSeconds: 554,
      },
      {
        id: "901-17",
        at: null,
        kind: "step",
        number: 3,
        label: "create spec",
      },
      {
        id: "901-18",
        at: null,
        kind: "tool",
        name: "read",
        arguments: {
          path: "src/run-state/issue-run-state.ts",
        },
        result: "148 lines",
        state: "completed",
      },
      {
        id: "901-19",
        at: null,
        kind: "tool",
        name: "write",
        arguments: {
          path: "docs/specs/2026-10-10-multi-run-cost-report-design.md",
        },
        result: "wrote 96 lines",
        state: "completed",
      },
      {
        id: "901-20",
        at: null,
        kind: "artifact",
        artifactId: "spec",
        text: "Spec draft written",
      },
      {
        id: "901-21",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command:
            "npx prettier --check docs/specs/2026-10-10-multi-run-cost-report-design.md",
        },
        result: "All matched files use Prettier code style!",
        state: "completed",
      },
      {
        id: "901-22",
        at: null,
        kind: "tool",
        name: "bash",
        arguments: {
          command:
            'git commit -m "docs(spec): add multi-run cost report design"',
        },
        result:
          "[agent/issue-227-spec 3e1a9c0] docs(spec): add multi-run cost report design\n 1 file changed, 96 insertions(+)",
        state: "completed",
      },
      {
        id: "901-23",
        at: "2026-11-13T09:27:00.000Z",
        kind: "message",
        author: "agent",
        role: "agent",
        blocks: [
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "The spec draft is ready: ",
              },
              {
                kind: "code",
                text: "docs/specs/2026-10-10-multi-run-cost-report-design.md",
              },
              {
                kind: "text",
                text: ". Three things worth checking:",
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
                  text: "The table has one row per run, oldest first.",
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
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Any changes, or should I open the spec pull request?",
              },
            ],
          },
        ],
        note: null,
      },
      {
        id: "901-24",
        at: "2026-11-13T09:40:00.000Z",
        kind: "divider",
        tone: "neutral",
        text: "Paused by roche. The worktree and the agent's session are kept.",
      },
    ],
    finalUsage: null,
  },
};
