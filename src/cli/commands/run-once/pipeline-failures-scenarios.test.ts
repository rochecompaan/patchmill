import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import { runStatePath, writeRunState } from "./run-state.ts";
import { runOneIssue } from "./pipeline.ts";
import {
  DEFAULT_LABEL_NAMES,
  issue,
  issueListPayload,
  labelListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";
import {
  createMockRunner,
  promptPath,
} from "../../../../test-support/run-once/mock-runner.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import {
  collectProgressEvents,
  commentBody,
} from "../../../../test-support/run-once/assertions.ts";

const NOW = new Date("2026-05-09T12:00:00.000Z");

function withRepo(args: string[], repoRoot: string): string[] {
  const separator = args.indexOf("--");
  if (separator === -1) return [...args, "--repo", repoRoot];
  return [
    ...args.slice(0, separator),
    "--repo",
    repoRoot,
    ...args.slice(separator),
  ];
}

test("runOneIssue marks deterministic blockers as needs-info without restoring agent-ready", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    31,
    ["agent-ready", "enhancement"],
    "Clarify pipeline blocker path",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-31-clarify-pipeline-blocker-path.md",
  );
  await writeFile(
    existingPlanPath,
    "# plan\n\n### Task 1: Blocker Task\n",
    "utf8",
  );
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
      return {
        code: 0,
        stdout:
          '{"status":"blocked","reason":"Need API ownership decision","questions":[{"question":"Which API should own the runner output?","recommendedAnswer":"Keep ownership in the existing triage package to avoid duplicating adapters."}],"commits":["789fed"],"validation":["tests not run"]}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "Need API ownership decision");
  const stepEvents = events
    .filter((event) => event.step)
    .map(
      (event) =>
        `${event.step?.type}:${event.step && "label" in event.step ? event.step.label : event.message}`,
    );
  const taskComplete = stepEvents.indexOf(
    "step-complete:implement task 1/1 blocker task",
  );
  const finalStart = stepEvents.indexOf("step-start:final result blocked");
  assert.ok(taskComplete >= 0, stepEvents.join("\n"));
  assert.ok(finalStart > taskComplete, stepEvents.join("\n"));
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.deepEqual(
    editCalls[1]?.args,
    withRepo(
      [
        "issues",
        "edit",
        "31",
        "--remove-labels",
        "in-progress",
        "--add-labels",
        "needs-info",
      ],
      config.repoRoot,
    ),
  );
  assert.equal(
    editCalls.some(
      (call) => call.args.includes("agent-ready") && call !== editCalls[0],
    ),
    false,
  );

  const blockerComment = runner.calls
    .filter((call) => call.command === "tea" && call.args[0] === "comment")
    .at(-1);
  assert.ok(blockerComment);
  assert.match(commentBody(blockerComment), /Automation blocked/);
  assert.match(commentBody(blockerComment), /needs more information/i);
  assert.match(
    commentBody(blockerComment),
    /Which API should own the runner output\?/,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 31), "utf8"),
  );
  assert.equal(runState.status, "blocked");
  assert.equal(runState.lastError, "Need API ownership decision");
  assert.deepEqual(runState.commits, ["789fed"]);
  assert.deepEqual(runState.validation, ["tests not run"]);
  assert.deepEqual(runState.blockerQuestions, [
    {
      question: "Which API should own the runner output?",
      recommendedAnswer:
        "Keep ownership in the existing triage package to avoid duplicating adapters.",
    },
  ]);
});

test("runOneIssue uses configured claim and blocker labels", async () => {
  const triagePolicy = createTriagePolicy({
    ...DEFAULT_PATCHMILL_CONFIG.labels,
    inProgress: "claimed",
    done: "completed-by-bot",
    needsInfo: "info-needed",
  });
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    triagePolicy,
    readyLabel: triagePolicy.labels.ready,
  });
  const selected = issue(
    32,
    [triagePolicy.labels.ready, "enhancement"],
    "Clarify custom lifecycle labels",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-32-clarify-custom-lifecycle-labels.md",
  );
  await writeFile(
    existingPlanPath,
    "# plan\n\n### Task 1: Blocker Task\n",
    "utf8",
  );
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
      return {
        code: 0,
        stdout: labelListPayload(
          DEFAULT_LABEL_NAMES.filter(
            (label) =>
              !["in-progress", "needs-info", "agent-done"].includes(label),
          ),
        ),
        stderr: "",
      };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "create"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"blocked","reason":"Need API ownership decision","questions":[{"question":"Which API should own the runner output?","recommendedAnswer":"Keep ownership in the existing triage package to avoid duplicating adapters."}],"commits":["789fed"],"validation":["tests not run"]}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  const claimedLabelCreate = runner.calls.find(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "create" &&
      call.args.includes("claimed"),
  );
  assert.ok(claimedLabelCreate);
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.deepEqual(
    editCalls[0]?.args,
    withRepo(
      [
        "issues",
        "edit",
        "32",
        "--remove-labels",
        triagePolicy.labels.ready,
        "--add-labels",
        "claimed",
      ],
      config.repoRoot,
    ),
  );
  assert.deepEqual(
    editCalls[1]?.args,
    withRepo(
      [
        "issues",
        "edit",
        "32",
        "--remove-labels",
        "claimed",
        "--add-labels",
        "info-needed",
      ],
      config.repoRoot,
    ),
  );
});

test("runOneIssue ensures a missing configured blocker label before applying it", async () => {
  const triagePolicy = createTriagePolicy({
    ...DEFAULT_PATCHMILL_CONFIG.labels,
    needsInfo: "info-needed",
  });
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    triagePolicy,
    readyLabel: triagePolicy.labels.ready,
  });
  const selected = issue(
    33,
    [triagePolicy.labels.ready, "enhancement"],
    "Create missing blocker label before applying it",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-33-create-missing-blocker-label-before-applying-it.md",
  );
  await writeFile(
    existingPlanPath,
    "# plan\n\n### Task 1: Blocker Task\n",
    "utf8",
  );
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
      return {
        code: 0,
        stdout: labelListPayload(
          DEFAULT_LABEL_NAMES.filter((label) => label !== "needs-info"),
        ),
        stderr: "",
      };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "create"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"blocked","reason":"Need API ownership decision","questions":[{"question":"Which API should own the runner output?","recommendedAnswer":"Keep ownership in the existing triage package to avoid duplicating adapters."}],"commits":["789fed"],"validation":["tests not run"]}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  const blockerLabelCreateIndex = runner.calls.findIndex(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "create" &&
      call.args.includes("info-needed"),
  );
  const blockerEditIndex = runner.calls.findIndex(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit" &&
      call.args.includes("info-needed"),
  );
  assert.ok(blockerLabelCreateIndex >= 0);
  assert.ok(blockerEditIndex > blockerLabelCreateIndex);
  assert.deepEqual(
    runner.calls[blockerLabelCreateIndex]?.args,
    withRepo(
      [
        "labels",
        "create",
        "--name",
        "info-needed",
        "--color",
        "#8957e5",
        "--description",
        "Needs reporter information or human decision before planning",
      ],
      config.repoRoot,
    ),
  );
  assert.deepEqual(
    runner.calls[blockerEditIndex]?.args,
    withRepo(
      [
        "issues",
        "edit",
        "33",
        "--remove-labels",
        triagePolicy.labels.inProgress,
        "--add-labels",
        "info-needed",
      ],
      config.repoRoot,
    ),
  );
});

test("runOneIssue does not persist generated spec path when spec creation fails", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    64,
    ["agent-ready", "bug"],
    "Fail before generated spec exists",
  );
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
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Create a design spec/);
      return { code: 1, stdout: "", stderr: "spec model unavailable" };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /spec model unavailable/);
  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 64), "utf8"),
  );
  assert.equal(runState.specPath, undefined);
  assert.equal(runState.planPath, undefined);
  assert.equal(runState.branch, undefined);
  assert.equal(runState.worktreePath, undefined);
});

test("runOneIssue does not persist generated spec path when spec creation blocks", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    64,
    ["agent-ready", "bug"],
    "Block before generated spec exists",
  );
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
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Create a design spec/);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "blocked",
          reason: "Need design clarification.",
          questions: [],
          commits: [],
          validation: [],
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 64), "utf8"),
  );
  assert.equal(runState.specPath, undefined);
  assert.equal(runState.planPath, undefined);
});

test("runOneIssue does not persist generated plan path when plan creation blocks", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    66,
    ["spec-approved", "bug"],
    "Block before generated plan exists",
  );
  const specPath =
    "docs/specs/2026-05-09-issue-66-block-before-generated-plan-exists-design.md";
  await writeFile(join(config.repoRoot, specPath), "# Existing spec\n", "utf8");
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
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Create an implementation plan/);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "blocked",
          reason: "Need planning clarification.",
          questions: [],
          commits: [],
          validation: [],
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 66), "utf8"),
  );
  assert.equal(runState.specPath, specPath);
  assert.equal(runState.planPath, undefined);
});

test("runOneIssue records and comments unexpected planning failures without replacing in-progress", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    41,
    ["agent-ready", "bug"],
    "Handle planning failure state",
  );
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
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "tea" && call.args[0] === "comment") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      if (/Create a design spec/.test(prompt)) {
        return {
          code: 0,
          stdout:
            '{"status":"spec-created","specPath":"docs/specs/spec.md","commit":"spec123"}',
          stderr: "",
        };
      }
      return { code: 1, stdout: "", stderr: "model unavailable" };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const logPath = join(config.runStateDir, "run.jsonl");
  const result = await runOneIssue(runner, config, {
    now: NOW,
    progress,
    logPath,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.logPath, logPath);
  assert.match(result.reason, /pi failed: model unavailable/);
  assert.ok(
    events.some(
      (event) =>
        event.level === "error" &&
        event.message === "blocked: pi failed: model unavailable",
    ),
  );
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.equal(editCalls.length, 1);

  const failureComment = runner.calls
    .filter((call) => call.command === "tea" && call.args[0] === "comment")
    .at(-1);
  assert.ok(failureComment);
  assert.match(commentBody(failureComment), /Automation failed unexpectedly/);
  assert.match(commentBody(failureComment), /remains in-progress/);
  assert.match(commentBody(failureComment), /model unavailable/);

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 41), "utf8"),
  );
  assert.equal(runState.status, "planning");
  assert.match(runState.lastError, /pi failed: model unavailable/);
  assert.equal(runState.planPath, undefined);

  const resumeRunner = createMockRunner(async (call) => {
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
                issue(
                  41,
                  ["in-progress", "bug"],
                  "Handle planning failure state",
                ),
                issue(99, ["agent-ready", "bug"], "Do not select me"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
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
    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"plan-created","planPath":"docs/plans/2026-05-09-issue-41-handle-planning-failure-state.md","commit":"abc123"}',
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const resumed = await runOneIssue(
    resumeRunner,
    { ...config, planOnly: true },
    { now: NOW },
  );

  assert.equal(resumed.status, "plan-created");
  assert.equal(resumed.issue.number, 41);
});

test("runOneIssue records and comments unexpected implementation failures without replacing in-progress", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    42,
    ["agent-ready", "enhancement"],
    "Handle implementation parse failure",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-42-handle-implementation-parse-failure.md",
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
      return { code: 0, stdout: '{"status":"unknown"}', stderr: "" };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /supported final JSON status/);
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.equal(editCalls.length, 1);

  const failureComment = runner.calls
    .filter((call) => call.command === "tea" && call.args[0] === "comment")
    .at(-1);
  assert.ok(failureComment);
  assert.match(commentBody(failureComment), /Automation failed unexpectedly/);
  assert.match(commentBody(failureComment), /remains in-progress/);
  assert.match(commentBody(failureComment), /supported final JSON status/);

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 42), "utf8"),
  );
  assert.equal(runState.status, "implementing");
  assert.equal(
    runState.planPath,
    "docs/plans/2026-05-01-issue-42-handle-implementation-parse-failure.md",
  );
  assert.equal(
    runState.branch,
    "agent/issue-42-handle-implementation-parse-failure",
  );
  assert.equal(
    runState.worktreePath,
    ".worktrees/patchmill-issue-42-handle-implementation-parse-failure",
  );
  assert.match(runState.lastError, /supported final JSON status/);

  const resumeRunner = createMockRunner(async (call) => {
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
                issue(
                  42,
                  ["in-progress", "enhancement"],
                  "Handle implementation parse failure",
                ),
                issue(100, ["agent-ready", "bug"], "Do not select me either"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree") {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-42-handle-implementation-parse-failure")}\n`,
        stderr: "",
      };
    }
    if (
      call.command === "git" &&
      call.args[0] === "-C" &&
      call.args[2] === "branch"
    ) {
      return {
        code: 0,
        stdout: "agent/issue-42-handle-implementation-parse-failure\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "log") {
      return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo/pr/42",
          branch: "agent/issue-42-handle-implementation-parse-failure",
          commits: ["abc123"],
          validation: ["just issue-runner-test ok"],
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const resumed = await runOneIssue(resumeRunner, config, { now: NOW });

  assert.equal(resumed.status, "pr-created");
  assert.equal(resumed.issue.number, 42);
});

test("runOneIssue does not duplicate unexpected planning failure comments on rerun and still updates lastError", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 61,
      title: "Retry planning failure",
      status: "planning",
      planPath: "docs/plans/2026-05-09-issue-61-retry-planning-failure.md",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
      },
      failureCommentKeys: ["unexpected-failure:planning"],
      lastError: "old planning error",
    },
    "2026-05-09T11:55:00.000Z",
  );

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
                issue(61, ["in-progress", "bug"], "Retry planning failure"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "pi")
      return { code: 1, stdout: "", stderr: "different planning failure" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args[0] === "comment",
    ),
    false,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 61), "utf8"),
  );
  assert.equal(runState.status, "planning");
  assert.equal(runState.lastError, "pi failed: different planning failure");
  assert.deepEqual(runState.failureCommentKeys, [
    "unexpected-failure:planning",
  ]);
});

test("runOneIssue does not duplicate unexpected implementation failure comments on rerun and still updates lastError", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const planPath = join(
    config.plansDir,
    "2026-05-09-issue-62-retry-implementation-failure.md",
  );
  await writeFile(planPath, "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 62,
      title: "Retry implementation failure",
      status: "implementing",
      planPath:
        "docs/plans/2026-05-09-issue-62-retry-implementation-failure.md",
      branch: "agent/issue-62-retry-implementation-failure",
      worktreePath:
        ".worktrees/patchmill-issue-62-retry-implementation-failure",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
      },
      failureCommentKeys: ["unexpected-failure:implementing"],
      lastError: "old implementation error",
    },
    "2026-05-09T11:55:00.000Z",
  );

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
                issue(
                  62,
                  ["in-progress", "bug"],
                  "Retry implementation failure",
                ),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree") {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-62-retry-implementation-failure")}\n`,
        stderr: "",
      };
    }
    if (
      call.command === "git" &&
      call.args[0] === "-C" &&
      call.args[2] === "branch"
    ) {
      return {
        code: 0,
        stdout: "agent/issue-62-retry-implementation-failure\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "log")
      return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (call.command === "pi")
      return { code: 0, stdout: '{"status":"unknown"}', stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args[0] === "comment",
    ),
    false,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 62), "utf8"),
  );
  assert.equal(runState.status, "implementing");
  assert.match(runState.lastError, /supported final JSON status/);
  assert.deepEqual(runState.failureCommentKeys, [
    "unexpected-failure:implementing",
  ]);
});

test("runOneIssue records unexpected start-comment failures after claim", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    43,
    ["agent-ready", "bug"],
    "Handle start comment failure",
  );
  let commentCalls = 0;
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
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "tea" && call.args[0] === "comment") {
      commentCalls += 1;
      return commentCalls === 1
        ? { code: 1, stdout: "", stderr: "start exploded" }
        : { code: 0, stdout: "", stderr: "" };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /tea comment failed for #43: start exploded/);
  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 2);
  assert.match(commentBody(comments[1]), /Automation failed unexpectedly/);

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 43), "utf8"),
  );
  assert.equal(runState.status, "claimed");
  assert.match(
    runState.lastError,
    /tea comment failed for #43: start exploded/,
  );
});

test("runOneIssue preserves blocked state when blocker comment fails", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    44,
    ["agent-ready", "enhancement"],
    "Preserve blocker state on comment failure",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-44-preserve-blocker-state-on-comment-failure.md",
  );
  await writeFile(existingPlanPath, "# plan\n", "utf8");
  let commentCalls = 0;
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
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "tea" && call.args[0] === "comment") {
      commentCalls += 1;
      return commentCalls === 2
        ? { code: 1, stdout: "", stderr: "blocker comment exploded" }
        : { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"blocked","reason":"Need product decision","questions":["Which variant should automation implement first?"],"commits":[],"validation":[]}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "Need product decision");
  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 2);
  assert.equal(
    comments.some((call) =>
      /Automation failed unexpectedly/.test(commentBody(call)),
    ),
    false,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 44), "utf8"),
  );
  assert.equal(runState.status, "blocked");
  assert.equal(runState.lastError, "Need product decision");
});

test("runOneIssue creates the in-progress label before claiming when Forgejo is missing it", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  const selected = issue(
    45,
    ["agent-ready", "bug"],
    "Ensure in-progress label exists",
  );
  const expectedPlanPath =
    "docs/plans/2026-05-09-issue-45-ensure-in-progress-label-exists.md";
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
      return {
        code: 0,
        stdout: labelListPayload(
          DEFAULT_LABEL_NAMES.filter((label) => label !== "in-progress"),
        ),
        stderr: "",
      };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "create"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "tea" && call.args[0] === "comment") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout: `planning...\n{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"abc123"}`,
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  const createIndex = runner.calls.findIndex(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "create",
  );
  const claimIndex = runner.calls.findIndex(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.ok(createIndex >= 0);
  assert.ok(claimIndex > createIndex);
  assert.deepEqual(
    runner.calls[createIndex]?.args,
    withRepo(
      [
        "labels",
        "create",
        "--name",
        "in-progress",
        "--color",
        "#fbca04",
        "--description",
        "Issue is currently being processed by automation",
      ],
      config.repoRoot,
    ),
  );
});
