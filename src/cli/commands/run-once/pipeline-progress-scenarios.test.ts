import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runOneIssue } from "./pipeline.ts";
import {
  issue,
  issueListPayload,
  labelListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";
import {
  appendPiSessionEntry,
  assistantToolCall,
  createMockRunner,
  initializePiSession,
  promptPath,
  waitForCondition,
  workflowPiCalls,
  writePiSessionMessage,
  type Call,
} from "../../../../test-support/run-once/mock-runner.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import {
  collectProgressEvents,
  commentBody,
} from "../../../../test-support/run-once/assertions.ts";
import type { CommandResult } from "./types.ts";

const NOW = new Date("2026-05-09T12:00:00.000Z");
const MINIMAL_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

async function writeTodo(
  repoRoot: string,
  id: string,
  title: string,
  status: string,
): Promise<void> {
  const dir = join(repoRoot, ".pi", "todos");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${id}.md`),
    `${JSON.stringify({ id, title, status })}\n\nbody\n`,
    "utf8",
  );
}

test("runOneIssue implementation heartbeat reads task progress from the issue worktree", async () => {
  const selected = issue(14, ["agent-ready"], "Progress Root");
  const config = await makeConfig({ dryRun: false, execute: true });
  const planPath = join(
    config.plansDir,
    "2026-05-09-issue-14-progress-root.md",
  );
  await writeFile(planPath, "# Plan\n", "utf8");

  const worktreePath = ".worktrees/patchmill-issue-14-progress-root";
  const worktreeRoot = join(config.repoRoot, worktreePath);
  for (let index = 1; index <= 8; index += 1) {
    await writeTodo(
      config.repoRoot,
      `main-${index}`,
      `issue-14-task-${String(index).padStart(2, "0")}-planned`,
      "completed",
    );
  }

  let finishRun: (result: CommandResult) => void = () => undefined;
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    ) {
      for (let index = 1; index <= 8; index += 1) {
        await writeTodo(
          worktreeRoot,
          `worktree-${index}`,
          `issue-14-task-${String(index).padStart(2, "0")}-planned`,
          index < 7 ? "closed" : "open",
        );
      }
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return new Promise<CommandResult>((resolve) => {
        finishRun = resolve;
      });
    }

    if (call.command === "tea") {
      return { code: 0, stdout: "", stderr: "" };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const run = runOneIssue(runner, config, {
    now: NOW,
    progress,
    heartbeatMs: 10,
  });

  await waitForCondition(
    () =>
      events.some(
        (event) =>
          event.level === "heartbeat" &&
          event.message.includes("implementing task 7/8"),
      ),
    () => events.map((event) => event.message).join("\n"),
  );
  finishRun({
    code: 0,
    stdout:
      '{"status":"pr-created","prUrl":"https://forgejo.example/pr/14","branch":"agent/issue-14-progress-root","commits":[],"validation":[]}',
    stderr: "",
  });
  await run;
});

test("runOneIssue emits visible implementation subtask step labels", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const planPath = join(
    config.plansDir,
    "2026-05-22-issue-15-ship-automation-pipeline.md",
  );
  await writeFile(
    planPath,
    [
      "# Ship Automation Pipeline Implementation Plan",
      "",
      "### Task 1: Date Range Model",
      "",
      "### Task 2: Dashboard Wiring",
    ].join("\n"),
    "utf8",
  );

  const worktreePath = ".worktrees/patchmill-issue-15-ship-automation-pipeline";
  const worktreeRoot = join(config.repoRoot, worktreePath);

  let implementationCall: Call | undefined;
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout:
          page === "1"
            ? issueListPayload([
                issue(15, ["agent-ready"], "Ship automation pipeline"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref")
      return { code: 1, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      implementationCall = call;
      await writeTodo(
        worktreeRoot,
        "task-1",
        "issue-15-task-01-date-range-model",
        "complete",
      );
      await writeTodo(
        worktreeRoot,
        "task-2",
        "issue-15-task-02-dashboard-wiring",
        "closed",
      );
      await writePiSessionMessage(call, "done", {
        input: 999999,
        output: 2200,
        totalTokens: 999999,
      });
      return {
        code: 0,
        stdout:
          '{"status":"pr-created","prUrl":"https://forgejo.example/pr/15","branch":"agent/issue-15-ship-automation-pipeline","commits":["def456"],"validation":["just issue-runner-test ok"],"reviewSummary":"reviewed"}',
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, {
    now: NOW,
    progress,
    heartbeatMs: 1,
  });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  assert.ok(implementationCall);
  const labels = events.flatMap((event) =>
    event.step?.type === "step-start" ? [event.step.label] : [],
  );
  assert.ok(
    labels.includes("implement task 1/2 date range model"),
    labels.join("\n"),
  );
  assert.ok(
    labels.includes("implement task 2/2 dashboard wiring"),
    labels.join("\n"),
  );
  assert.equal(labels.includes("implement issue"), false);
});

test("runOneIssue moves streamed tool calls under the active implementation task", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const planPath = join(config.plansDir, "2026-05-22-issue-77-agent-output.md");
  await writeFile(
    planPath,
    [
      "# Agent Output Plan",
      "",
      "### Task 1: First Cycle",
      "",
      "### Task 2: Second Cycle",
      "",
      "### Task 3: Third Cycle",
    ].join("\n"),
    "utf8",
  );

  const worktreePath = ".worktrees/patchmill-issue-77-agent-output";
  const worktreeRoot = join(config.repoRoot, worktreePath);

  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout:
          page === "1"
            ? issueListPayload([issue(77, ["agent-ready"], "Agent output")])
            : "[]",
        stderr: "",
      };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref")
      return { code: 1, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      await writeTodo(
        worktreeRoot,
        "task-1",
        "issue-77-task-01-first-cycle",
        "in-progress",
      );
      await writeTodo(
        worktreeRoot,
        "task-2",
        "issue-77-task-02-second-cycle",
        "open",
      );
      await writeTodo(
        worktreeRoot,
        "task-3",
        "issue-77-task-03-third-cycle",
        "open",
      );
      await initializePiSession(call);

      await appendPiSessionEntry(
        call,
        assistantToolCall("call-1", "subagent", { agent: "worker" }),
      );
      await waitForCondition(
        () =>
          events.some((event) => event.observation?.toolCallId === "call-1"),
        () => "waiting for call-1 observation",
      );

      await writeTodo(
        worktreeRoot,
        "task-1",
        "issue-77-task-01-first-cycle",
        "closed",
      );
      await writeTodo(
        worktreeRoot,
        "task-2",
        "issue-77-task-02-second-cycle",
        "in-progress",
      );
      await appendPiSessionEntry(
        call,
        assistantToolCall("call-2", "subagent", { agent: "worker" }),
      );
      await waitForCondition(
        () =>
          events.some((event) => event.observation?.toolCallId === "call-2"),
        () => "waiting for call-2 observation",
      );

      await writeTodo(
        worktreeRoot,
        "task-2",
        "issue-77-task-02-second-cycle",
        "closed",
      );
      await writeTodo(
        worktreeRoot,
        "task-3",
        "issue-77-task-03-third-cycle",
        "in-progress",
      );
      await appendPiSessionEntry(
        call,
        assistantToolCall("call-3", "subagent", { agent: "worker" }),
      );
      await waitForCondition(
        () =>
          events.some((event) => event.observation?.toolCallId === "call-3"),
        () => "waiting for call-3 observation",
      );

      await writeTodo(
        worktreeRoot,
        "task-3",
        "issue-77-task-03-third-cycle",
        "closed",
      );
      await appendPiSessionEntry(
        call,
        assistantToolCall("call-4", "subagent", { agent: "reviewer" }),
      );
      await waitForCondition(
        () =>
          events.some((event) => event.observation?.toolCallId === "call-4"),
        () => "waiting for call-4 observation",
      );

      return {
        code: 0,
        stdout:
          '{"status":"pr-created","prUrl":"https://forgejo.example/pr/77","branch":"agent/issue-77-agent-output","commits":["def456"],"validation":["ok"],"reviewSummary":"reviewed"}',
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, {
    now: NOW,
    progress,
    heartbeatMs: 10_000,
  });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  const rendered = events
    .map((event) => {
      if (event.step?.type === "step-start") return `start:${event.step.label}`;
      if (event.step?.type === "step-complete")
        return `complete:${event.step.label}`;
      if (
        event.observation?.type === "tool-call" &&
        event.observation.toolName === "subagent"
      )
        return `tool:${event.observation.toolCallId}`;
      return undefined;
    })
    .filter((line): line is string => line !== undefined);

  assert.deepEqual(
    rendered.filter(
      (line) =>
        line.startsWith("start:implement task") ||
        line.startsWith("complete:implement task") ||
        line === "start:final review and landing" ||
        line === "complete:final review and landing" ||
        line.startsWith("tool:call-"),
    ),
    [
      "start:implement task 1/3 first cycle",
      "tool:call-1",
      "complete:implement task 1/3 first cycle",
      "start:implement task 2/3 second cycle",
      "tool:call-2",
      "complete:implement task 2/3 second cycle",
      "start:implement task 3/3 third cycle",
      "tool:call-3",
      "complete:implement task 3/3 third cycle",
      "start:final review and landing",
      "tool:call-4",
      "complete:final review and landing",
    ],
  );
});

test("runOneIssue validates committed visual evidence before cleanup", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const planPath = join(
    config.plansDir,
    "2026-05-22-issue-31-dashboard-visual-evidence.md",
  );
  await writeFile(planPath, "# plan\n", "utf8");
  const worktreePath =
    ".worktrees/patchmill-issue-31-dashboard-visual-evidence";
  const worktreeRoot = join(config.repoRoot, worktreePath);
  const screenshotPath = "docs/screenshots/dashboard.png";
  const commentBodies: string[] = [];

  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout:
          page === "1"
            ? issueListPayload([
                issue(31, ["agent-ready"], "Dashboard visual evidence"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment") {
      commentBodies.push(commentBody(call));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref")
      return { code: 1, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args.join(" ") === `ls-tree -r --name-only HEAD -- ${screenshotPath}`
    )
      return { code: 0, stdout: `${screenshotPath}\n`, stderr: "" };
    if (
      call.command === "git" &&
      call.args.join(" ") === `diff --quiet -- ${screenshotPath}`
    )
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args.join(" ") === `diff --cached --quiet -- ${screenshotPath}`
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      await writeTodo(
        worktreeRoot,
        "task-1",
        "issue-31-task-01-dashboard-visual-evidence",
        "closed",
      );
      await mkdir(join(worktreeRoot, "docs", "screenshots"), {
        recursive: true,
      });
      await writeFile(join(worktreeRoot, screenshotPath), MINIMAL_PNG_BYTES);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/owner/patchmill/pulls/77",
          branch: "agent/issue-31-dashboard-visual-evidence",
          commits: ["def456"],
          validation: ["just playwright-test ok"],
          reviewSummary: "Fresh reviewer screenshot review: passed",
          visualEvidence: [
            {
              screenshotPath,
              caption: "Dashboard after selecting last 8 weeks",
            },
          ],
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  assert.deepEqual(result.visualEvidence, [
    {
      screenshotPath,
      caption: "Dashboard after selecting last 8 weeks",
    },
  ]);
  assert.match(
    commentBodies.find((body) => body.includes("Automation handoff ready")) ??
      "",
    /PR: https:\/\/forgejo\.example\/owner\/patchmill\/pulls\/77/,
  );
});

test("runOneIssue blocks temporary visual evidence before cleanup", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const planPath = join(
    config.plansDir,
    "2026-05-22-issue-32-temporary-visual-evidence.md",
  );
  await writeFile(planPath, "# plan\n", "utf8");
  const worktreePath =
    ".worktrees/patchmill-issue-32-temporary-visual-evidence";
  const worktreeRoot = join(config.repoRoot, worktreePath);

  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout:
          page === "1"
            ? issueListPayload([
                issue(32, ["agent-ready"], "Temporary visual evidence"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref")
      return { code: 1, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      await writeTodo(
        worktreeRoot,
        "task-1",
        "issue-32-task-01-temporary-visual-evidence",
        "closed",
      );
      await mkdir(join(worktreeRoot, ".tmp"), { recursive: true });
      await writeFile(
        join(worktreeRoot, ".tmp", "dashboard.png"),
        MINIMAL_PNG_BYTES,
      );
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/owner/patchmill/pulls/78",
          branch: "agent/issue-32-temporary-visual-evidence",
          commits: ["def456"],
          validation: ["just playwright-test ok"],
          reviewSummary: "Fresh reviewer screenshot review: passed",
          visualEvidence: [
            {
              screenshotPath: ".tmp/dashboard.png",
              caption: "Temporary screenshot that would vanish on cleanup",
            },
          ],
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked", JSON.stringify(result));
  assert.match(
    result.reason,
    /Visual evidence must be a committed reference screenshot under docs\/screenshots/u,
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        call.args[0] === "worktree" &&
        call.args[1] === "remove",
    ),
    false,
  );
});

test("runOneIssue keeps implementation task totals anchored to the plan when transient todos differ", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const planPath = join(
    config.plansDir,
    "2026-05-22-issue-19-dashboard-date-ranges.md",
  );
  await writeFile(
    planPath,
    [
      "# Dashboard Date Ranges Implementation Plan",
      "",
      "### Task 1: Dashboard Range Primitives",
      "",
      "### Task 2: Aggregate Range Threading",
      "",
      "### Task 3: Render Global Filter UI",
      "",
      "### Task 4: Playwright Coverage",
      "",
      "### Task 5: Final Verification Cleanup",
    ].join("\n"),
    "utf8",
  );

  const worktreePath = ".worktrees/patchmill-issue-19-dashboard-date-ranges";
  const worktreeRoot = join(config.repoRoot, worktreePath);

  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout:
          page === "1"
            ? issueListPayload([
                issue(19, ["agent-ready"], "Dashboard date ranges"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref")
      return { code: 1, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      await writeTodo(
        worktreeRoot,
        "task-1",
        "issue-19-task-01-dashboard-range-primitives",
        "open",
      );
      await writeTodo(
        worktreeRoot,
        "task-2",
        "issue-19-task-02-aggregate-range-threading",
        "open",
      );
      await writeTodo(
        worktreeRoot,
        "task-3",
        "issue-19-task-03-render-global-filter-ui",
        "open",
      );
      await writeTodo(
        worktreeRoot,
        "task-4",
        "issue-19-task-04-dashboard-csv-excel-exports",
        "open",
      );
      await writeTodo(
        worktreeRoot,
        "task-5",
        "issue-19-task-05-playwright-coverage",
        "open",
      );
      await writeTodo(
        worktreeRoot,
        "task-6",
        "issue-19-task-06-final-verification-cleanup",
        "open",
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeTodo(
        worktreeRoot,
        "task-1",
        "issue-19-task-01-dashboard-range-primitives",
        "closed",
      );
      await writeTodo(
        worktreeRoot,
        "task-2",
        "issue-19-task-02-aggregate-range-threading",
        "closed",
      );
      await writeTodo(
        worktreeRoot,
        "task-3",
        "issue-19-task-03-render-global-filter-ui",
        "closed",
      );
      await writeTodo(
        worktreeRoot,
        "task-4",
        "issue-19-task-04-playwright-coverage",
        "closed",
      );
      await writeTodo(
        worktreeRoot,
        "task-5",
        "issue-19-task-05-final-verification-cleanup",
        "closed",
      );
      await writeTodo(
        worktreeRoot,
        "task-6",
        "issue-19-task-06-final-verification-cleanup",
        "closed",
      );
      await writePiSessionMessage(call, "done", {
        input: 999999,
        output: 2200,
        totalTokens: 999999,
      });
      return {
        code: 0,
        stdout:
          '{"status":"pr-created","prUrl":"https://forgejo.example/pr/19","branch":"agent/issue-19-dashboard-date-ranges","commits":["def456"],"validation":["just issue-runner-test ok"],"reviewSummary":"reviewed"}',
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, {
    now: NOW,
    progress,
    heartbeatMs: 1,
  });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  const labels = events.flatMap((event) =>
    event.step?.type === "step-start" ? [event.step.label] : [],
  );
  assert.ok(
    labels.includes("implement task 1/5 dashboard range primitives"),
    labels.join("\n"),
  );
  assert.ok(
    labels.includes("implement task 5/5 final verification cleanup"),
    labels.join("\n"),
  );
  assert.equal(
    labels.some((label) => label.includes("/6")),
    false,
    labels.join("\n"),
  );
});

test("runOneIssue uses an existing plan without legacy team lookup", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const selected = issue(
    21,
    ["agent-ready", "bug"],
    "Fix isolated issue runner",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-21-fix-isolated-issue-runner.md",
  );
  await writeFile(existingPlanPath, "# plan\n", "utf8");
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }

    if (
      call.command === "git" &&
      (call.args[0] === "status" || call.args[0] === "worktree")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }

    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      assert.equal(
        call.cwd,
        join(
          config.repoRoot,
          ".worktrees/patchmill-issue-21-fix-isolated-issue-runner",
        ),
      );
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(
        prompt,
        /Read AGENTS\.md and the implementation plan at docs\/plans\/2026-05-01-issue-21-fix-isolated-issue-runner\.md/,
      );
      assert.match(prompt, /Subagent support:/);
      assert.doesNotMatch(prompt, new RegExp("Authoritative agent " + "team"));
      return {
        code: 0,
        stdout:
          '{"status":"pr-created","prUrl":"https://forgejo.example/pr/21","branch":"agent/issue-21-fix-isolated-issue-runner","commits":["123abc"],"validation":["just test ok"],"reviewSummary":"reviewed"}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(
    result.planPath,
    "docs/plans/2026-05-01-issue-21-fix-isolated-issue-runner.md",
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 1);
});
