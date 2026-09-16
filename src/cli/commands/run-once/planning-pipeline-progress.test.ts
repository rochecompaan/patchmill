import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { planningIssueLockPath } from "../../../workflow/planning-issue-lock.ts";
import { collectProgressEvents } from "../../../../test-support/run-once/assertions.ts";
import {
  issue,
  issueListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";
import {
  assistantToolCall,
  createMockRunner,
  subagentProgressEntry,
} from "../../../../test-support/run-once/mock-runner.ts";
import { createPlanningProviderScenario } from "../../../../test-support/run-once/planning-provider-scenario.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import { AgentIssueConsoleProgressReporter } from "./console-progress.ts";
import { runOneIssue } from "./pipeline.ts";
import {
  compositeProgressReporter,
  type AgentIssueProgressEvent,
} from "./progress.ts";

const NOW = new Date("2099-01-01T00:00:00.000Z");

type SessionFixture = {
  id: string;
  outputTokens: number;
  includeSubagent?: boolean;
};

function sessionEntries(input: SessionFixture): unknown[] {
  return [
    { type: "session", version: 3, id: `session-${input.id}` },
    assistantToolCall(`tool-${input.id}`, "read", { path: "AGENTS.md" }),
    ...(input.includeSubagent
      ? [
          subagentProgressEntry({
            version: 1,
            kind: "workflow",
            toolCallId: `tool-${input.id}`,
            workflowRunId: `workflow-${input.id}`,
            childId: "worker",
            state: "running",
            agent: "worker",
            model: "openai/gpt-5.6",
            thinking: "high",
          }),
        ]
      : []),
    {
      type: "message",
      id: `usage-${input.id}`,
      parentId: null,
      message: {
        role: "assistant",
        content: [],
        usage: { output: input.outputTokens },
      },
    },
  ];
}

function createPlanningProgressHarness(
  sessions: readonly SessionFixture[],
  onSessionPath?: (event: AgentIssueProgressEvent) => Promise<void>,
) {
  const collected = collectProgressEvents();
  const lines: string[] = [];
  const consoleProgress = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: NOW,
  });
  let sessionIndex = 0;
  const seedSessions = {
    async event(event: AgentIssueProgressEvent) {
      if (event.message !== "pi session path") return;
      await onSessionPath?.(event);
      const sessionPath = event.data;
      assert.equal(typeof sessionPath, "string");
      const fixture = sessions[sessionIndex++];
      assert.ok(fixture, `unexpected Pi session ${sessionIndex}`);
      await mkdir(dirname(sessionPath), { recursive: true });
      await writeFile(
        sessionPath,
        `${sessionEntries(fixture)
          .map((entry) => JSON.stringify(entry))
          .join("\n")}\n`,
        "utf8",
      );
    },
  };
  return {
    events: collected.events,
    lines,
    progress: compositeProgressReporter([
      collected.progress,
      consoleProgress,
      seedSessions,
    ]),
  };
}

function startedLabels(
  events: ReturnType<typeof collectProgressEvents>["events"],
) {
  return events.flatMap((event) =>
    event.step?.type === "step-start" ? [event.step.label] : [],
  );
}

function completions(
  events: ReturnType<typeof collectProgressEvents>["events"],
) {
  return events.flatMap((event) =>
    event.step?.type === "step-complete" ? [event.step] : [],
  );
}

function assertProviderScenarioRunStart(
  events: ReturnType<typeof collectProgressEvents>["events"],
  now: Date,
) {
  assert.deepEqual(
    events.filter((event) => event.step?.type === "run-start"),
    [
      {
        time: now.toISOString(),
        level: "info",
        stage: "run",
        message: "issue #190 · Provider scenario",
        issueNumber: 190,
        step: {
          type: "run-start",
          issueNumber: 190,
          title: "Provider scenario",
        },
      },
    ],
  );
}

test("planning facade announces an attempt before an active lock stops it", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  const selected = issue(245, ["agent-ready"], "Planning progress");
  const lockPath = planningIssueLockPath(config.runStateDir, selected.number);
  await mkdir(join(config.runStateDir, "planning-pr-v1", "locks"), {
    recursive: true,
  });
  await writeFile(
    lockPath,
    `${JSON.stringify({
      version: 1,
      issueNumber: selected.number,
      runId: "123e4567-e89b-42d3-a456-426614174000",
      ownershipId: "223e4567-e89b-42d3-a456-426614174000",
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: NOW.toISOString(),
    })}\n`,
    "utf8",
  );
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args[0] === "issues") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });
  const { events, progress } = collectProgressEvents();

  try {
    const result = await runOneIssue(runner, config, { now: NOW, progress });

    assert.equal(result.status, "stopped");
    if (result.status === "stopped")
      assert.equal(result.reason, "issue-locked");
    assert.equal(
      runner.calls.some((call) => call.args.includes("edit")),
      false,
    );
    assert.deepEqual(
      events.filter((event) => event.step?.type === "run-start"),
      [
        {
          time: NOW.toISOString(),
          level: "info",
          stage: "run",
          message: "issue #245 · Planning progress",
          issueNumber: 245,
          step: {
            type: "run-start",
            issueNumber: 245,
            title: "Planning progress",
          },
        },
      ],
    );
  } finally {
    await rm(config.repoRoot, { recursive: true, force: true });
  }
});

test("planning facade streams exact spec-agent observations inside its create step", async () => {
  const scenario = await createPlanningProviderScenario({
    provider: "forgejo-tea",
    gates: { specRequired: true, planRequired: false },
  });
  const { runner, config, now } = scenario.invocation();
  const harness = createPlanningProgressHarness([
    { id: "spec", outputTokens: 4200, includeSubagent: true },
  ]);

  try {
    const result = await runOneIssue(runner, config, {
      now,
      progress: harness.progress,
    });

    assert.equal(result.status, "review-pending", JSON.stringify(result));
    if (result.status === "review-pending") assert.equal(result.phase, "spec");
    assertProviderScenarioRunStart(harness.events, now);
    assert.deepEqual(
      harness.events
        .filter(
          (event) =>
            event.step?.type === "step-start" ||
            event.step?.type === "step-complete" ||
            event.observation !== undefined,
        )
        .map((event) =>
          event.step?.type === "step-start"
            ? `start:${event.step.label}`
            : event.step?.type === "step-complete"
              ? `complete:${event.step.label}`
              : `observation:${event.observation?.type}`,
        ),
      [
        "start:create spec",
        "observation:tool-call",
        "observation:subagent-progress",
        "observation:assistant-usage",
        "complete:create spec",
      ],
    );
    const completion = completions(harness.events).find(
      (step) => step.label === "create spec",
    );
    assert.deepEqual(completion, {
      type: "step-complete",
      label: "create spec",
      toolCalls: 1,
      taskOutputTokens: 4200,
      totalOutputTokens: 4200,
      elapsedSeconds: 0,
    });
    assert.deepEqual(
      harness.events
        .filter((event) => event.observation !== undefined)
        .map((event) => event.stage),
      ["pi-plan", "pi-plan", "pi-plan"],
    );
    assert.ok(
      harness.lines.includes("issue #190 · Provider scenario"),
      harness.lines.join("\n"),
    );
    assert.ok(
      harness.lines.includes("01 create spec"),
      harness.lines.join("\n"),
    );
    assert.ok(
      harness.lines.includes("   🔧 read (path=AGENTS.md)"),
      harness.lines.join("\n"),
    );
    assert.ok(
      harness.lines.includes(
        "   🤖 subagent (agent=worker, model=openai/gpt-5.6, thinking=high)",
      ),
      harness.lines.join("\n"),
    );
    assert.ok(
      harness.lines.includes(
        "   tokens: task 4.2k total 4.2k   time elapsed: 0s",
      ),
      harness.lines.join("\n"),
    );
  } finally {
    await scenario.cleanup();
  }
});

test("planning reconciliation has no phantom steps and merged spec resumes with create plan", async () => {
  const scenario = await createPlanningProviderScenario({
    provider: "forgejo-tea",
    gates: { specRequired: true, planRequired: false },
  });
  const { runner, config, now } = scenario.invocation();

  try {
    const first = createPlanningProgressHarness([
      { id: "spec", outputTokens: 100 },
    ]);
    await runOneIssue(runner, config, { now, progress: first.progress });

    const resumed = createPlanningProgressHarness([]);
    const reviewResult = await runOneIssue(runner, config, {
      now,
      progress: resumed.progress,
    });
    assert.equal(reviewResult.status, "review-pending");
    assertProviderScenarioRunStart(resumed.events, now);
    assert.deepEqual(startedLabels(resumed.events), []);
    assert.equal(
      resumed.events.some((event) => event.message === "pi session path"),
      false,
    );
    assert.equal(
      resumed.events.some((event) => event.observation !== undefined),
      false,
    );

    await scenario.mergeOpenPlanningPull();
    const planned = createPlanningProgressHarness([
      { id: "plan", outputTokens: 200 },
    ]);
    await runOneIssue(
      runner,
      { ...config, planOnly: true },
      {
        now,
        progress: planned.progress,
      },
    );
    assert.deepEqual(startedLabels(planned.events), ["create plan"]);
  } finally {
    await scenario.cleanup();
  }
});

test("planning artifact steps share cumulative accounting across spec and plan", async () => {
  const scenario = await createPlanningProviderScenario({
    provider: "forgejo-tea",
    gates: { specRequired: false, planRequired: true },
  });
  const { runner, config, now } = scenario.invocation();
  const harness = createPlanningProgressHarness([
    { id: "spec", outputTokens: 100 },
    { id: "plan", outputTokens: 200 },
  ]);

  try {
    await runOneIssue(runner, config, { now, progress: harness.progress });
    assert.deepEqual(startedLabels(harness.events), [
      "create spec",
      "create plan",
    ]);
    assert.deepEqual(
      completions(harness.events).map((step) => ({
        label: step.label,
        taskOutputTokens: step.taskOutputTokens,
        totalOutputTokens: step.totalOutputTokens,
      })),
      [
        { label: "create spec", taskOutputTokens: 100, totalOutputTokens: 100 },
        { label: "create plan", taskOutputTokens: 200, totalOutputTokens: 300 },
      ],
    );
  } finally {
    await scenario.cleanup();
  }
});

test("planning and implementation steps share one attempt-wide token total", async () => {
  const scenario = await createPlanningProviderScenario({
    provider: "forgejo-tea",
    gates: { specRequired: false, planRequired: false },
  });
  const { runner, config, now } = scenario.invocation();
  const harness = createPlanningProgressHarness(
    [
      { id: "spec", outputTokens: 100 },
      { id: "plan", outputTokens: 200 },
      { id: "implementation", outputTokens: 300 },
    ],
    async (event) => {
      if (event.stage !== "pi-implementation") return;
      const todoRoot = resolve(
        config.repoRoot,
        config.projectPolicy.pi.taskContract.todoRoot,
      );
      await mkdir(todoRoot, { recursive: true });
      await writeFile(
        join(todoRoot, "issue-190-progress.md"),
        `${JSON.stringify({
          title: "issue-190-task-01-progress-accounting",
          status: "closed",
          tags: ["agent-issue", "issue-190"],
        })}\n\nprogress fixture\n`,
        "utf8",
      );
    },
  );

  try {
    const result = await runOneIssue(runner, config, {
      now,
      progress: harness.progress,
    });
    assert.equal(result.status, "pr-created", JSON.stringify(result));
    assert.deepEqual(
      completions(harness.events)
        .filter((step) =>
          ["create spec", "create plan", "final review and landing"].includes(
            step.label,
          ),
        )
        .map((step) => ({
          label: step.label,
          toolCalls: step.toolCalls,
          taskOutputTokens: step.taskOutputTokens,
          totalOutputTokens: step.totalOutputTokens,
        })),
      [
        {
          label: "create spec",
          toolCalls: 1,
          taskOutputTokens: 100,
          totalOutputTokens: 100,
        },
        {
          label: "create plan",
          toolCalls: 1,
          taskOutputTokens: 200,
          totalOutputTokens: 300,
        },
        {
          label: "final review and landing",
          toolCalls: 1,
          taskOutputTokens: 300,
          totalOutputTokens: 600,
        },
      ],
    );
    const finalStepStart = harness.events.findIndex(
      (event) =>
        event.step?.type === "step-start" &&
        event.step.label === "final review and landing",
    );
    const finalStepComplete = harness.events.findIndex(
      (event) =>
        event.step?.type === "step-complete" &&
        event.step.label === "final review and landing",
    );
    const implementationTool = harness.events.findIndex(
      (event) =>
        event.stage === "pi-implementation" &&
        event.observation?.type === "tool-call",
    );
    assert.ok(
      finalStepStart < implementationTool &&
        implementationTool < finalStepComplete,
      JSON.stringify(harness.events),
    );
  } finally {
    await scenario.cleanup();
  }
});
