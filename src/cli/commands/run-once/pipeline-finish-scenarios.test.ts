import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  workflowPiCalls,
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

const LANDING_SKILLS = {
  ...DEFAULT_PATCHMILL_CONFIG.skills,
  landing: "project-landing",
};

const cleanupHook = "./scripts/cleanup.sh";

test("runOneIssue reuses existing implementation result on resume without rerunning pi", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-reuse-implementation.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Reuse implementation",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-reuse-implementation",
      worktreePath: ".worktrees/patchmill-issue-45-reuse-implementation",
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/45",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      reviewSummary: "reviewed",
      landingDecision: "PR required: needs manual verification",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
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
                issue(45, ["in-progress"], "Reuse implementation"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-reuse-implementation")}\n`,
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
        stdout: "agent/issue-45-reuse-implementation\n",
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
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    )
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(result.prUrl, "https://forgejo/pr/45");
  assert.deepEqual(result.commits, ["abc123"]);
  assert.deepEqual(result.validation, ["just issue-runner-test ok"]);
  assert.equal(result.reviewSummary, "reviewed");
  assert.equal(
    result.landingDecision,
    "PR required: needs manual verification",
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
});

test("runOneIssue finishes saved pr-created handoff without requiring an agent team", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-complete-pr-created.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Complete PR created",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-complete-pr-created",
      worktreePath: ".worktrees/patchmill-issue-45-complete-pr-created",
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/45",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
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
                issue(45, ["in-progress"], "Complete PR created"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-complete-pr-created")}\n`,
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
        stdout: "agent/issue-45-complete-pr-created\n",
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
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    )
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  assert.ok(
    runner.calls.some(
      (call) => call.command === "tea" && call.args[0] === "comment",
    ),
  );
  assert.ok(
    runner.calls.some(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit" &&
        call.args.includes("agent-done"),
    ),
  );
});

test("runOneIssue resumes and completes saved handoff with configured lifecycle labels", async () => {
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
  const planPath =
    "docs/plans/2026-05-14-issue-45-complete-custom-lifecycle-labels.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Complete custom lifecycle labels",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-complete-custom-lifecycle-labels",
      worktreePath:
        ".worktrees/patchmill-issue-45-complete-custom-lifecycle-labels",
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/45",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
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
                issue(45, ["claimed"], "Complete custom lifecycle labels"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-complete-custom-lifecycle-labels")}\n`,
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
        stdout: "agent/issue-45-complete-custom-lifecycle-labels\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "log")
      return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: labelListPayload([
          ...DEFAULT_LABEL_NAMES.filter(
            (label) =>
              !["in-progress", "needs-info", "agent-done"].includes(label),
          ),
          "claimed",
          "info-needed",
        ]),
        stderr: "",
      };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "create"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    )
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  const doneLabelCreate = runner.calls.find(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "create" &&
      call.args.includes("completed-by-bot"),
  );
  assert.ok(doneLabelCreate);
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
        "45",
        "--remove-labels",
        "claimed",
        "--add-labels",
        "completed-by-bot",
      ],
      config.repoRoot,
    ),
  );
});

test("runOneIssue runs configured cleanup hook script", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    worktreePrefix: "patchmill-issue-",
    cleanupHook,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-cleanup-example.md";
  const worktreePath = ".worktrees/patchmill-issue-45-cleanup-example";
  const worktreeRoot = join(config.repoRoot, worktreePath);
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Cleanup Example",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-cleanup-example",
      worktreePath,
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/45",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
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
            ? issueListPayload([issue(45, ["in-progress"], "Cleanup Example")])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: `worktree ${worktreeRoot}\n`, stderr: "" };
    }
    if (
      call.command === "git" &&
      call.args[0] === "-C" &&
      call.args[2] === "branch"
    ) {
      return {
        code: 0,
        stdout: "agent/issue-45-cleanup-example\n",
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
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    )
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "bash" &&
      call.args[0] === "./scripts/cleanup.sh" &&
      call.cwd === worktreeRoot
    )
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args.join(" ") === `worktree remove ${worktreePath}`
    )
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args.join(" ") === "branch -D agent/issue-45-cleanup-example"
    )
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "pr-created");
  const cleanupCalls = runner.calls.filter(
    (call) =>
      call.command === "bash" && call.args[0] === "./scripts/cleanup.sh",
  );
  assert.deepEqual(cleanupCalls, [
    {
      command: "bash",
      args: ["./scripts/cleanup.sh"],
      cwd: worktreeRoot,
      onStdout: undefined,
      onStderr: undefined,
    },
  ]);
  assert.ok(
    events.some(
      (event) =>
        event.stage === "cleanup" &&
        event.message ===
          "cleanup hook ./scripts/cleanup.sh: completed for .worktrees/patchmill-issue-45-cleanup-example",
    ),
  );
  const cleanupGitCalls = runner.calls.filter(
    (call) =>
      call.command === "git" &&
      (call.args[0] === "worktree" || call.args[0] === "branch") &&
      (call.args.includes("remove") || call.args.includes("-D")),
  );
  assert.deepEqual(
    cleanupGitCalls.map((call) => call.args),
    [
      ["worktree", "remove", worktreePath],
      ["branch", "-D", "agent/issue-45-cleanup-example"],
    ],
  );
  const hookIndex = runner.calls.findIndex(
    (call) => call.command === "bash" && call.args[0] === cleanupHook,
  );
  const worktreeRemoveIndex = runner.calls.findIndex(
    (call) =>
      call.command === "git" &&
      call.args.join(" ") === `worktree remove ${worktreePath}`,
  );
  assert.ok(hookIndex >= 0);
  assert.ok(worktreeRemoveIndex > hookIndex);
  assert.ok(
    events.some(
      (event) =>
        event.stage === "cleanup" &&
        event.level === "info" &&
        event.message === `removed local worktree ${worktreePath}`,
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.stage === "cleanup" &&
        event.level === "info" &&
        event.message === "deleted local branch agent/issue-45-cleanup-example",
    ),
  );
  const state = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  );
  assert.equal(state.branch, "agent/issue-45-cleanup-example");
  assert.equal(state.worktreePath, worktreePath);
});

test("runOneIssue reports pr cleanup failures without failing handoff", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    worktreePrefix: "patchmill-issue-",
  });
  const planPath = "docs/plans/2026-05-14-issue-45-cleanup-failure.md";
  const worktreePath = ".worktrees/patchmill-issue-45-cleanup-failure";
  const worktreeRoot = join(config.repoRoot, worktreePath);
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Cleanup Failure",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-cleanup-failure",
      worktreePath,
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/45",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
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
            ? issueListPayload([issue(45, ["in-progress"], "Cleanup Failure")])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: `worktree ${worktreeRoot}\n`, stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "-C" &&
      call.args[2] === "branch"
    )
      return {
        code: 0,
        stdout: "agent/issue-45-cleanup-failure\n",
        stderr: "",
      };
    if (call.command === "git" && call.args[0] === "log")
      return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
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
    if (
      call.command === "git" &&
      call.args.join(" ") === `worktree remove ${worktreePath}`
    )
      return { code: 128, stdout: "", stderr: "fatal: worktree is dirty" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "pr-created");
  assert.ok(
    events.some(
      (event) =>
        event.stage === "cleanup" &&
        event.level === "error" &&
        /git worktree remove failed/.test(event.message),
    ),
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        call.args[0] === "branch" &&
        call.args[1] === "-D",
    ),
    false,
  );
});

test("runOneIssue finishes saved merged handoff when direct landing is enabled and skills.landing is configured", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    skills: LANDING_SKILLS,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-complete-merged.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Complete merged",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-complete-merged",
      worktreePath: ".worktrees/patchmill-issue-45-complete-merged",
      implementationStatus: "merged",
      mergeCommit: "def456",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
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
            ? issueListPayload([issue(45, ["in-progress"], "Complete merged")])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-complete-merged")}\n`,
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
        stdout: "agent/issue-45-complete-merged\n",
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
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    )
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "merged");
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  assert.ok(
    runner.calls.some(
      (call) => call.command === "tea" && call.args[0] === "comment",
    ),
  );
  assert.ok(
    runner.calls.some(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit" &&
        call.args.includes("agent-done"),
    ),
  );
});

test("runOneIssue rejects saved merged handoff when skills.landing is not configured", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-complete-merged.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Complete merged",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-complete-merged",
      worktreePath: ".worktrees/patchmill-issue-45-complete-merged",
      implementationStatus: "merged",
      mergeCommit: "def456",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
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
            ? issueListPayload([issue(45, ["in-progress"], "Complete merged")])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-complete-merged")}\n`,
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
        stdout: "agent/issue-45-complete-merged\n",
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
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Saved implementation state returned merged but direct landing requires git\.allowDirectLand=true and configured skills\.landing/,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
});

test("runOneIssue rejects saved merged handoff when direct landing is disabled", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    allowDirectLand: false,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-complete-merged.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Complete merged",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-complete-merged",
      worktreePath: ".worktrees/patchmill-issue-45-complete-merged",
      implementationStatus: "merged",
      mergeCommit: "def456",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
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
            ? issueListPayload([issue(45, ["in-progress"], "Complete merged")])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-complete-merged")}\n`,
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
        stdout: "agent/issue-45-complete-merged\n",
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
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Saved implementation state returned merged while git\.allowDirectLand is false/,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
});

test("runOneIssue rejects stale finished implementationCompleted state before relabel without an agent team", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const planPath =
    "docs/plans/2026-05-14-issue-45-stale-finished-implementation.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Stale finished implementation",
      status: "finished",
      planPath,
      branch: "agent/issue-45-stale-finished-implementation",
      worktreePath:
        ".worktrees/patchmill-issue-45-stale-finished-implementation",
      implementationStatus: "merged",
      mergeCommit: "stale123",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
        handoffCommentPosted: true,
        doneLabelEnsured: true,
        doneLabelApplied: true,
      },
    },
    NOW.toISOString(),
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
                issue(45, ["agent-ready"], "Stale finished implementation"),
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
      (call.args[0] === "issues" || call.args[0] === "comment")
    )
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Non-resumable run state for issue #45 has stale branch\/worktree; clean up before starting a fresh run/,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  assert.equal(
    runner.calls.some(
      (call) => call.command === "git" && call.args[0] === "worktree",
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args[0] === "labels",
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args[0] === "comment",
    ),
    false,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  ) as Record<string, unknown> & {
    checkpoints?: Record<string, unknown>;
  };
  assert.equal(runState.status, "finished");
  assert.equal(runState.mergeCommit, "stale123");
  assert.equal(runState.prUrl, undefined);
  assert.equal(runState.checkpoints?.implementationCompleted, true);
  assert.equal(runState.branch, "agent/issue-45-stale-finished-implementation");
  assert.equal(
    runState.worktreePath,
    ".worktrees/patchmill-issue-45-stale-finished-implementation",
  );
});

test("runOneIssue rejects stale finished branch and worktree before resetting state", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const planPath =
    "docs/plans/2026-05-14-issue-45-stale-finished-same-title.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Stale finished same title",
      status: "finished",
      planPath,
      branch: "agent/issue-45-stale-finished-same-title",
      worktreePath: ".worktrees/patchmill-issue-45-stale-finished-same-title",
      implementationStatus: "merged",
      mergeCommit: "stale123",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
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
                issue(45, ["agent-ready"], "Stale finished same title"),
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
      (call.args[0] === "issues" || call.args[0] === "comment")
    )
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Non-resumable run state for issue #45 has stale branch\/worktree; clean up before starting a fresh run/,
  );
  const firstRunState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(firstRunState.status, "finished");
  assert.equal(
    firstRunState.branch,
    "agent/issue-45-stale-finished-same-title",
  );
  assert.equal(
    firstRunState.worktreePath,
    ".worktrees/patchmill-issue-45-stale-finished-same-title",
  );

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Non-resumable run state for issue #45 has stale branch\/worktree; clean up before starting a fresh run/,
  );

  const secondRunState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(secondRunState.status, "finished");
  assert.equal(
    secondRunState.branch,
    "agent/issue-45-stale-finished-same-title",
  );
  assert.equal(
    secondRunState.worktreePath,
    ".worktrees/patchmill-issue-45-stale-finished-same-title",
  );

  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  assert.equal(
    runner.calls.some(
      (call) => call.command === "git" && call.args[0] === "worktree",
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "comment" &&
        /Unexpected failure/.test(commentBody(call)),
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args[0] === "comment",
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args[0] === "labels",
    ),
    false,
  );
});

test("runOneIssue rejects stale finished branch and worktree when title changed", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-stale-finished-renamed.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Old finished title",
      status: "finished",
      planPath,
      branch: "agent/issue-45-old-finished-title",
      worktreePath: ".worktrees/patchmill-issue-45-old-finished-title",
      implementationStatus: "merged",
      mergeCommit: "stale123",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
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
                issue(45, ["agent-ready"], "Renamed finished title"),
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
      (call.args[0] === "issues" || call.args[0] === "comment")
    )
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Non-resumable run state for issue #45 has stale branch\/worktree; clean up before starting a fresh run/,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.command === "git" && call.args[0] === "worktree",
    ),
    false,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(runState.status, "finished");
  assert.equal(runState.branch, "agent/issue-45-old-finished-title");
  assert.equal(
    runState.worktreePath,
    ".worktrees/patchmill-issue-45-old-finished-title",
  );
});

test("runOneIssue reruns Pi when implementationCompleted state is missing required saved fields", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const planPath =
    "docs/plans/2026-05-14-issue-45-incomplete-implementation-state.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Incomplete implementation state",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-incomplete-implementation-state",
      worktreePath:
        ".worktrees/patchmill-issue-45-incomplete-implementation-state",
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/stale-45",
      commits: ["abc123"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
      },
    },
    NOW.toISOString(),
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
                issue(45, ["in-progress"], "Incomplete implementation state"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-incomplete-implementation-state")}\n`,
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
        stdout: "agent/issue-45-incomplete-implementation-state\n",
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
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Resume context:/);
      assert.match(prompt, /abc123 partial work/);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo/pr/45",
          branch: "agent/issue-45-incomplete-implementation-state",
          commits: ["def456"],
          validation: ["just issue-runner-test ok"],
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(result.prUrl, "https://forgejo/pr/45");
  assert.deepEqual(result.commits, ["def456"]);
  assert.ok(runner.calls.some((call) => call.command === "pi"));
});

test("runOneIssue rejects resumable saved branch/worktree mismatch before worktree commands", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-branch-mismatch.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Old branch mismatch",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-old-branch-mismatch",
      worktreePath: ".worktrees/patchmill-issue-45-old-branch-mismatch",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
      },
    },
    NOW.toISOString(),
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
            ? issueListPayload([issue(45, ["in-progress"], "Branch mismatch")])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Saved branch agent\/issue-45-old-branch-mismatch does not match expected branch agent\/issue-45-branch-mismatch/,
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        call.args[0] === "worktree" &&
        call.args[1] === "list",
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        call.args[0] === "worktree" &&
        call.args[1] === "add",
    ),
    false,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args[0] === "comment",
    ),
    false,
  );
});

test("runOneIssue skips handoff and done labels when checkpoints are complete", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    skills: LANDING_SKILLS,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-finished-handoff.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Finished handoff",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-finished-handoff",
      worktreePath: ".worktrees/patchmill-issue-45-finished-handoff",
      implementationStatus: "merged",
      mergeCommit: "abc999",
      commits: ["abc123"],
      validation: ["just issue-runner-test ok"],
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
        implementationCompleted: true,
        handoffCommentPosted: true,
        doneLabelEnsured: true,
        doneLabelApplied: true,
      },
    },
    NOW.toISOString(),
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
            ? issueListPayload([issue(45, ["in-progress"], "Finished handoff")])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-finished-handoff")}\n`,
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
        stdout: "agent/issue-45-finished-handoff\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "log")
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "merged");
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args[0] === "comment",
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit",
    ),
    false,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  ) as Record<string, unknown> & {
    checkpoints?: Record<string, unknown>;
  };
  assert.equal(runState.status, "finished");
  assert.equal(runState.checkpoints?.doneLabelApplied, true);
});
