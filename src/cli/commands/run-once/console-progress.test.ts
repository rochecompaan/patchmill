import test from "node:test";
import assert from "node:assert/strict";
import { AgentIssueConsoleProgressReporter } from "./console-progress.ts";
import type { AgentIssueProgressEvent } from "./progress.ts";
import type { PersistedSubagentProgress } from "../../../pi/subagent-progress.ts";

const BASE = new Date("2026-05-22T10:00:00.000Z");

function event(
  partial: Partial<AgentIssueProgressEvent>,
): AgentIssueProgressEvent {
  return {
    time: partial.time ?? BASE.toISOString(),
    level: partial.level ?? "info",
    stage: partial.stage ?? "step",
    message: partial.message ?? "",
    ...partial,
  };
}

function childProgress(
  progress: PersistedSubagentProgress,
): AgentIssueProgressEvent {
  return event({
    level: "debug",
    stage: "pi-implementation",
    message: "subagent-progress",
    observation: { type: "subagent-progress", progress },
  });
}

test("console reporter renders each authoritative child metadata tuple once", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });
  const identity = {
    version: 1,
    kind: "workflow",
    toolCallId: "call-launch",
    workflowRunId: "workflow-1",
    childId: "review",
  } as const;
  const metadata = {
    agent: "reviewer",
    model: "openai/team/models/gpt-5.6-sol",
    thinking: "xhigh",
  } as const;

  reporter.event(
    event({ step: { type: "step-start", label: "implement task" } }),
  );
  for (const state of ["pending", "running", "completed"] as const) {
    reporter.event(childProgress({ ...identity, state, ...metadata }));
  }
  reporter.event(
    childProgress({ ...identity, state: "completed", ...metadata }),
  );
  reporter.event(
    childProgress({
      ...identity,
      state: "completed",
      inventoryClosed: true,
      ...metadata,
    }),
  );
  reporter.event(
    childProgress({
      ...identity,
      state: "completed",
      ...metadata,
      thinking: "high",
    }),
  );
  reporter.event(
    childProgress({
      ...identity,
      state: "completed",
      ...metadata,
      model: "openai/team/models/gpt-5.6-pro",
    }),
  );
  reporter.event(
    childProgress({
      ...identity,
      state: "completed",
      ...metadata,
      agent: "auditor",
    }),
  );
  reporter.event(
    childProgress({
      ...identity,
      childId: "audit",
      state: "failed",
      ...metadata,
    }),
  );

  assert.deepEqual(lines, [
    "01 implement task",
    "   🤖 subagent (agent=reviewer, model=openai/team/models/gpt-5.6-sol, thinking=xhigh)",
    "   🤖 subagent (agent=reviewer, model=openai/team/models/gpt-5.6-sol, thinking=high)",
    "   🤖 subagent (agent=reviewer, model=openai/team/models/gpt-5.6-pro, thinking=xhigh)",
    "   🤖 subagent (agent=auditor, model=openai/team/models/gpt-5.6-sol, thinking=xhigh)",
    "   🤖 subagent (agent=reviewer, model=openai/team/models/gpt-5.6-sol, thinking=xhigh)",
  ]);
});

test("console reporter omits unavailable child metadata outside a step", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });
  const direct = {
    version: 1,
    kind: "direct",
    toolCallId: "call-direct",
    runId: "run-1",
  } as const;

  reporter.event(childProgress({ ...direct, childIndex: 0, agent: "worker" }));
  reporter.event(
    childProgress({
      ...direct,
      childIndex: 1,
      agent: "worker",
      model: "provider/team/models/gpt-5.6-sol",
    }),
  );
  reporter.event(
    childProgress({
      ...direct,
      childIndex: 2,
      agent: "worker",
      thinking: "xhigh",
    }),
  );

  assert.deepEqual(lines, [
    "🤖 subagent (agent=worker)",
    "🤖 subagent (agent=worker, model=provider/team/models/gpt-5.6-sol)",
    "🤖 subagent (agent=worker, thinking=xhigh)",
  ]);
});

test("console reporter renders unresolved child fallbacks once", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });
  const workflow = {
    version: 1,
    kind: "workflow",
    toolCallId: "call-workflow",
    workflowRunId: "workflow-1",
    childId: "review-step",
  } as const;

  reporter.event(
    event({ step: { type: "step-start", label: "final review" } }),
  );
  reporter.event(
    childProgress({
      ...workflow,
      state: "pending",
      model: "not-authoritative",
    }),
  );
  const unresolved = {
    ...workflow,
    state: "failed",
    model: "must-not-render",
    thinking: "must-not-render",
    unresolved: true,
  } as const;
  reporter.event(childProgress(unresolved));
  reporter.event(childProgress(unresolved));
  reporter.event(childProgress({ ...unresolved, state: "stopped" }));

  const authoritative = { ...workflow, childId: "known-child" } as const;
  reporter.event(
    childProgress({ ...authoritative, state: "running", agent: "reviewer" }),
  );
  reporter.event(
    childProgress({ ...authoritative, state: "failed", unresolved: true }),
  );
  reporter.event(
    childProgress({
      version: 1,
      kind: "direct",
      toolCallId: "call-direct",
      runId: "run-123",
      childIndex: 0,
      state: "failed",
      unresolved: true,
    }),
  );

  assert.deepEqual(lines, [
    "01 final review",
    "   🤖 subagent (child=review-step, unresolved=true)",
    "   🤖 subagent (agent=reviewer)",
    "   🤖 subagent (runId=run-123, childIndex=0, unresolved=true)",
  ]);
  assert.equal(
    lines.some((line) => line.includes("model=must-not-render")),
    false,
  );
  assert.equal(
    lines.some((line) => line.includes("thinking=must-not-render")),
    false,
  );
});

test("console reporter keeps unresolved fallback identities scoped outside a step", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });

  for (const suffix of ["a", "b"]) {
    reporter.event(
      childProgress({
        version: 1,
        kind: "workflow",
        toolCallId: `call-${suffix}`,
        workflowRunId: `workflow-${suffix}`,
        childId: "review-step",
        state: "failed",
        unresolved: true,
      }),
    );
  }

  assert.deepEqual(lines, [
    "🤖 subagent (child=review-step, unresolved=true)",
    "🤖 subagent (child=review-step, unresolved=true)",
  ]);
});

test("console reporter renders numbered steps with tool-call summaries and output token summaries", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });

  reporter.event(
    event({
      message: "issue #19 · Add filters",
      step: { type: "run-start", issueNumber: 19, title: "Add filters" },
    }),
  );
  reporter.event(
    event({
      message: "create plan",
      step: { type: "step-start", label: "create plan" },
    }),
  );
  reporter.event(
    event({
      level: "debug",
      stage: "pi-plan",
      message: "tool",
      observation: {
        type: "tool-call",
        toolName: "read",
        arguments: {
          path: "mobile/app/src/main/java/com/patchmill/PickingLogRepository.kt",
          offset: 500,
          limit: 35,
        },
      },
    }),
  );
  reporter.event(
    event({
      level: "debug",
      stage: "pi-plan",
      message: "tool",
      observation: {
        type: "tool-call",
        toolName: "bash",
        arguments: {
          command:
            'rg -n "Picking Log|Trimming Log|Container Assignments" mobile',
          timeout: 15,
        },
      },
    }),
  );
  reporter.event(
    event({
      level: "debug",
      stage: "pi-plan",
      message: "usage",
      observation: { type: "assistant-usage", outputTokens: 4200 },
    }),
  );
  reporter.event(
    event({
      time: "2026-05-22T10:01:12.000Z",
      message: "create plan",
      step: { type: "step-complete", label: "create plan" },
    }),
  );

  assert.deepEqual(lines, [
    "issue #19 · Add filters",
    "01 create plan",
    "   🔧 read (path=mobile/app/src/main/java/com/patchmill/PickingL..., offset=500, limit=35)",
    '   🔧 bash (command=rg -n "Picking Log|Trimming Log|Container Assig..., timeout=15)',
    "   tokens: task 4.2k total 4.2k   time elapsed: 1m12s",
  ]);
});

test("console reporter writes tool-call summaries as observations arrive", () => {
  const chunks: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    write: (chunk) => chunks.push(chunk),
    startedAt: BASE,
  });

  reporter.event(
    event({
      message: "create plan",
      step: { type: "step-start", label: "create plan" },
    }),
  );
  reporter.event(
    event({
      level: "debug",
      stage: "pi-plan",
      message: "tool",
      observation: {
        type: "tool-call",
        toolName: "read",
        arguments: {
          path: "mobile/app/src/main/java/com/patchmill/PickingLogRepository.kt",
          offset: 500,
          limit: 35,
        },
      },
    }),
  );

  assert.deepEqual(chunks, [
    "01 create plan\n",
    "   🔧 read (path=mobile/app/src/main/java/com/patchmill/PickingL..., offset=500, limit=35)\n",
  ]);

  reporter.event(
    event({
      level: "debug",
      stage: "pi-plan",
      message: "tool",
      observation: {
        type: "tool-call",
        toolName: "bash",
        arguments: {
          command:
            'rg -n "Picking Log|Trimming Log|Container Assignments" mobile',
          timeout: 15,
        },
      },
    }),
  );

  assert.deepEqual(chunks, [
    "01 create plan\n",
    "   🔧 read (path=mobile/app/src/main/java/com/patchmill/PickingL..., offset=500, limit=35)\n",
    '   🔧 bash (command=rg -n "Picking Log|Trimming Log|Container Assig..., timeout=15)\n',
  ]);

  reporter.event(
    event({
      level: "debug",
      stage: "pi-plan",
      message: "usage",
      observation: { type: "assistant-usage", outputTokens: 4200 },
    }),
  );
  reporter.event(
    event({
      time: "2026-05-22T10:01:12.000Z",
      message: "create plan",
      step: { type: "step-complete", label: "create plan" },
    }),
  );

  assert.deepEqual(chunks, [
    "01 create plan\n",
    "   🔧 read (path=mobile/app/src/main/java/com/patchmill/PickingL..., offset=500, limit=35)\n",
    '   🔧 bash (command=rg -n "Picking Log|Trimming Log|Container Assig..., timeout=15)\n',
    "   tokens: task 4.2k total 4.2k   time elapsed: 1m12s\n",
  ]);
});

test("console reporter renders subagent tool calls with only agent details", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });

  reporter.event(
    event({
      message: "implement task",
      step: { type: "step-start", label: "implement task" },
    }),
  );
  reporter.event(
    event({
      level: "debug",
      stage: "pi-implementation",
      message: "tool",
      observation: {
        type: "tool-call",
        toolName: "subagent",
        arguments: {
          agent: "worker",
          model: "anthropic/claude-sonnet-4",
          task: "Long implementation instructions that should not be streamed into the operator log",
        },
      },
    }),
  );
  reporter.event(
    event({
      level: "debug",
      stage: "pi-implementation",
      message: "tool",
      observation: {
        type: "tool-call",
        toolName: "subagent",
        arguments: {
          tasks: [
            { agent: "worker", task: "First parallel task" },
            { agent: "reviewer", task: "Second parallel task" },
          ],
        },
      },
    }),
  );

  assert.deepEqual(lines, [
    "01 implement task",
    "   🤖 subagent (agent=worker)",
    "   🤖 subagent (agents=worker, reviewer)",
  ]);
});

test("console reporter renders subagent management calls as normal tools", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });

  reporter.event(
    event({
      message: "implement task",
      step: { type: "step-start", label: "implement task" },
    }),
  );
  reporter.event(
    event({
      level: "debug",
      stage: "pi-implementation",
      message: "tool",
      observation: {
        type: "tool-call",
        toolName: "subagent",
        arguments: { action: "list" },
      },
    }),
  );

  assert.deepEqual(lines, [
    "01 implement task",
    "   🔧 subagent (action=list)",
  ]);
});

test("console reporter suppresses heartbeat and raw text observations", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });

  reporter.event(
    event({
      message: "issue #19 · Add filters",
      step: { type: "run-start", issueNumber: 19, title: "Add filters" },
    }),
  );
  reporter.event(
    event({
      message: "create plan",
      step: { type: "step-start", label: "create plan" },
    }),
  );
  reporter.event(
    event({
      level: "heartbeat",
      stage: "pi-plan",
      message: "[issue #19] planning | tok: task=1k total=2k | elapsed 4m",
    }),
  );
  reporter.event(
    event({
      level: "debug",
      stage: "pi-plan",
      message: "text",
      observation: { type: "text", text: "raw skill body" },
    }),
  );
  reporter.event(
    event({
      time: "2026-05-22T10:00:04.000Z",
      message: "create plan",
      step: { type: "step-complete", label: "create plan" },
    }),
  );

  assert.deepEqual(lines, [
    "issue #19 · Add filters",
    "01 create plan",
    "   tokens: task 0.0k total 0.0k   time elapsed: 4s",
  ]);
});

test("console reporter renders console-only messages inside the current step", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });

  reporter.event(
    event({
      message: "extract issue artifact sources",
      step: { type: "step-start", label: "extract issue artifact sources" },
    }),
  );
  reporter.event(
    event({
      level: "info",
      stage: "artifact-extraction",
      message: "untrusted artifact author",
      consoleMessage:
        "⚠ found spec artifact from roche, but roche is not a trusted artifact author",
    }),
  );
  reporter.event(
    event({
      time: "2026-05-22T10:00:04.000Z",
      message: "extract issue artifact sources",
      step: { type: "step-complete", label: "extract issue artifact sources" },
    }),
  );

  assert.deepEqual(lines, [
    "01 extract issue artifact sources",
    "   ⚠ found spec artifact from roche, but roche is not a trusted artifact author",
    "   tokens: task 0.0k total 0.0k   time elapsed: 4s",
  ]);
});

test("console reporter renders mandatory implementation task labels", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });

  reporter.event(
    event({
      message: "issue #19 · Filters",
      step: { type: "run-start", issueNumber: 19, title: "Filters" },
    }),
  );
  reporter.event(
    event({
      message: "implement task 1/6 date range model",
      step: {
        type: "step-start",
        label: "implement task 1/6 date range model",
      },
    }),
  );
  reporter.event(
    event({
      level: "debug",
      stage: "pi-implementation",
      message: "usage",
      observation: { type: "assistant-usage", outputTokens: 2100 },
    }),
  );
  reporter.event(
    event({
      time: "2026-05-22T10:03:08.000Z",
      message: "implement task 1/6 date range model",
      step: {
        type: "step-complete",
        label: "implement task 1/6 date range model",
      },
    }),
  );
  reporter.event(
    event({
      message: "implement task 2/6 dashboard wiring",
      step: {
        type: "step-start",
        label: "implement task 2/6 dashboard wiring",
      },
    }),
  );

  assert.deepEqual(lines.slice(0, 5), [
    "issue #19 · Filters",
    "01 implement task 1/6 date range model",
    "   tokens: task 2.1k total 2.1k   time elapsed: 3m08s",
    "",
    "02 implement task 2/6 dashboard wiring",
  ]);
});

test("console reporter separates completed steps with a blank line", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });

  reporter.event(
    event({
      message: "select issue",
      step: { type: "step-start", label: "select issue" },
    }),
  );
  reporter.event(
    event({
      time: "2026-05-22T10:00:01.000Z",
      message: "select issue",
      step: { type: "step-complete", label: "select issue" },
    }),
  );
  reporter.event(
    event({
      message: "use existing plan",
      step: { type: "step-start", label: "use existing plan" },
    }),
  );
  reporter.event(
    event({
      time: "2026-05-22T10:00:02.000Z",
      message: "use existing plan",
      step: { type: "step-complete", label: "use existing plan" },
    }),
  );

  assert.deepEqual(lines, [
    "01 select issue",
    "   tokens: task 0.0k total 0.0k   time elapsed: 1s",
    "",
    "02 use existing plan",
    "   tokens: task 0.0k total 0.0k   time elapsed: 2s",
  ]);
});

test("console reporter defers final result and captures its metrics", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
    deferFinalResult: true,
  });
  reporter.event(event({ step: { type: "step-start", label: "task" } }));
  reporter.event(
    event({
      level: "debug",
      observation: { type: "assistant-usage", outputTokens: 56_000 },
    }),
  );
  reporter.event(
    event({
      time: "2026-05-22T10:01:00.000Z",
      step: { type: "step-complete", label: "task" },
    }),
  );
  reporter.event(
    event({ step: { type: "step-start", label: "final result pr-created" } }),
  );
  reporter.event(
    event({
      time: "2026-05-22T14:20:02.000Z",
      step: {
        type: "step-complete",
        label: "final result pr-created",
        elapsedSeconds: 15_602,
      },
    }),
  );
  assert.deepEqual(reporter.finalResultSnapshot(), {
    stepNumber: 2,
    totalOutputTokens: 56_000,
    elapsedSeconds: 15_602,
  });
  assert.equal(
    lines.some((line) => line.includes("final result")),
    false,
  );
});

test("console reporter has no deferred snapshot before completion or without a final step", () => {
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine() {},
    startedAt: BASE,
    deferFinalResult: true,
  });
  assert.equal(reporter.finalResultSnapshot(), undefined);
  reporter.event(
    event({ step: { type: "step-start", label: "final result pr-created" } }),
  );
  assert.equal(reporter.finalResultSnapshot(), undefined);
  reporter.event(
    event({
      step: { type: "step-complete", label: "final result pr-created" },
    }),
  );
  assert.deepEqual(reporter.finalResultSnapshot(), {
    stepNumber: 1,
    totalOutputTokens: 0,
    elapsedSeconds: 0,
  });

  const ordinary = new AgentIssueConsoleProgressReporter({ writeLine() {} });
  ordinary.event(event({ step: { type: "step-start", label: "task" } }));
  ordinary.event(event({ step: { type: "step-complete", label: "task" } }));
  assert.equal(ordinary.finalResultSnapshot(), undefined);
});

test("console reporter uses completion event accounting fields without synthesizing tool-call dots", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });

  reporter.event(
    event({
      message: "claim issue",
      step: { type: "step-start", label: "claim issue" },
    }),
  );
  reporter.event(
    event({
      observation: { type: "assistant-usage", outputTokens: 400 },
      level: "debug",
      stage: "pi-plan",
      message: "usage",
    }),
  );
  reporter.event(
    event({
      time: "2026-05-22T10:00:05.000Z",
      message: "claim issue",
      step: {
        type: "step-complete",
        label: "claim issue",
        taskOutputTokens: 1200,
        totalOutputTokens: 2400,
        toolCalls: 3,
        elapsedSeconds: 5,
      },
    }),
  );

  assert.deepEqual(lines, [
    "01 claim issue",
    "   tokens: task 1.2k total 2.4k   time elapsed: 5s",
  ]);
});
