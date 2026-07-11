import test from "node:test";
import assert from "node:assert/strict";
import { AgentIssueConsoleProgressReporter } from "./console-progress.ts";
import type { AgentIssueProgressEvent } from "./progress.ts";

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
