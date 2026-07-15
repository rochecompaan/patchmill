/* eslint-disable @typescript-eslint/no-unused-vars */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { DEFAULT_PATCHMILL_POLICY } from "../../../policy/defaults.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import {
  buildSkillPackMetadata,
  hashText,
} from "../../../workflow/skill-pack.ts";
import { bundledVisualEvidenceSkillPath } from "../../../workflow/skills.ts";
import { runStatePath, writeRunState } from "./run-state.ts";
import { runOneIssue } from "./pipeline.ts";
import { JsonlProgressReporter } from "./progress.ts";
import { assertNoLegacyProjectText } from "../../../../test-support/legacy-project-text.ts";
import { formatPublishedArtifactComment } from "../../../workflow/artifacts/published-artifacts.ts";
import {
  DEFAULT_LABEL_NAMES,
  issue,
  issueListPayload,
  issueViewPayload,
  labelListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";
import {
  appendPiSessionEntry,
  assistantToolCall,
  createMockRunner,
  delay,
  initializePiSession,
  promptPath,
  waitForCondition,
  workflowPiCalls,
  writePiSessionMessage,
  type Call,
} from "../../../../test-support/run-once/mock-runner.ts";
import {
  approvalPolicy,
  blockedRecoveryRunner,
  makeConfig,
  runPlanApprovedImplementationScenario,
  specAndPlanApprovalPolicy,
  writeBlockedRecoveryRunState,
} from "../../../../test-support/run-once/pipeline-fixtures.ts";
import {
  collectProgressEvents,
  commentBody,
  gitBaseContainmentFailure,
  gitBaseContainmentResult,
} from "../../../../test-support/run-once/assertions.ts";
import type { CommandResult } from "./types.ts";

const NOW = new Date("2026-05-09T12:00:00.000Z");
const MINIMAL_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

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

test("runOneIssue dry-run lists open issues and returns the selected agent-ready issue without mutations", async () => {
  const config = await makeConfig();
  const runner = createMockRunner((call) => {
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
                issue(8, ["agent-ready", "priority:low"]),
                issue(3, ["agent-ready", "priority:high"]),
              ])
            : "[]",
        stderr: "",
      };
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

  assert.equal(result.status, "dry-run");
  assert.equal(result.issue.number, 3);
  assert.equal(result.transition, "agent-ready -> agent-done");
  assert.equal(result.logPath, logPath);
  assert.deepEqual(
    events.map((event) => event.message),
    [
      "listing open issues",
      "selected #3 Issue 3",
      "checking issue branch base containment",
    ],
  );
  assert.deepEqual(
    runner.calls.map(
      (call) => `${call.command} ${call.args[0]} ${call.args[1]}`,
    ),
    [
      "tea issues list",
      "tea issues list",
      "git rev-parse --verify",
      "git rev-parse --verify",
      "git log --oneline",
    ],
  );
});

test("runOneIssue dry-run blocks when the configured issue base is ahead of the target PR base", async () => {
  const config = await makeConfig();
  const selected = issue(45, ["agent-ready"], "Unsafe base");
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args.includes("issues")) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    const preflight = gitBaseContainmentFailure(call);
    if (preflight) return preflight;
    return { code: 0, stdout: "", stderr: "" };
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Configured git\.baseRef HEAD is not contained in refs\/remotes\/origin\/main/,
  );

  assert.equal(
    runner.calls.some(
      (call) => call.command === "git" && call.args[0] === "status",
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args.includes("labels"),
    ),
    false,
  );
});

test("runOneIssue execute blocks unsafe issue base before claim, comments, run state, worktree, or Pi", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(45, ["agent-ready"], "Unsafe base");
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args.includes("issues")) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    const preflight = gitBaseContainmentFailure(call);
    if (preflight) return preflight;
    return { code: 0, stdout: "", stderr: "" };
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /abc1234 chore: initialize Patchmill/);
      return true;
    },
  );

  assert.equal(
    runner.calls.some(
      (call) => call.command === "git" && call.args[0] === "status",
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.command === "git" && call.args[0] === "worktree",
    ),
    false,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args.includes("comment"),
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args.includes("labels"),
    ),
    false,
  );
  await assert.rejects(
    () => readFile(runStatePath(config.runStateDir, selected.number), "utf8"),
    /ENOENT/,
  );
});

test("runOneIssue skips base containment preflight when no eligible issue exists", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args.includes("issues")) {
      return { code: 0, stdout: issueListPayload([]), stderr: "" };
    }
    throw new Error(
      `unexpected command ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.deepEqual(result, { status: "no-issue" });
  assert.equal(
    runner.calls.some((call) => call.command === "git"),
    false,
  );
});

test("runOneIssue dry-run does not log skip diagnostics when automatic selection succeeds", async () => {
  const config = await makeConfig();
  const runner = createMockRunner((call) => {
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
                issue(10, ["needs-info"], "Skipped but not logged"),
                issue(3, ["agent-ready", "priority:high"], "Selected issue"),
              ])
            : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "dry-run");
  assert.equal(result.issue.number, 3);
  assert.deepEqual(
    events.map((event) => event.message),
    [
      "listing open issues",
      "selected #3 Selected issue",
      "checking issue branch base containment",
    ],
  );
  assert.equal(
    events.some((event) => event.level === "debug"),
    false,
  );
});

test("runOneIssue dry-run for blocked saved workspace skips recovery inspection", async () => {
  const config = await makeConfig({ issueNumber: 45 });
  await writeBlockedRecoveryRunState(config);
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list" &&
      call.args[call.args.indexOf("--state") + 1] === "all" &&
      call.args[call.args.indexOf("--keyword") + 1] === "45"
    ) {
      return {
        code: 0,
        stdout: issueListPayload([
          issue(45, ["agent-ready"], "Recover blocked run"),
        ]),
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "dry-run");
  assert.equal(result.issue.number, 45);
  assert.equal(result.transition, "agent-ready -> agent-done");
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        (call.args[0] === "status" || call.args[0] === "worktree"),
    ),
    false,
  );
});

test("runOneIssue automatic selection includes agent-ready when spec approval is required", async () => {
  const config = await makeConfig({
    approvalPolicy: approvalPolicy({ specRequired: true }),
  });
  const runner = createMockRunner((call) => {
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
                issue(1, ["agent-ready", "priority:critical"], "Needs spec"),
                issue(
                  2,
                  ["agent-ready", "priority:high", "spec-approved"],
                  "Spec approved",
                ),
              ])
            : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "dry-run");
  assert.equal(result.issue.number, 1);
});

test("runOneIssue returns approval-required for explicit issue waiting on spec review", async () => {
  const config = await makeConfig({
    issueNumber: 7,
    approvalPolicy: approvalPolicy({
      specRequired: true,
      specApprovedLabel: "spec-ok",
    }),
  });
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list" &&
      call.args[call.args.indexOf("--state") + 1] === "all" &&
      call.args[call.args.indexOf("--keyword") + 1] === "7"
    ) {
      return {
        code: 0,
        stdout: issueListPayload([issue(7, ["spec-review"])]),
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "approval-required");
  assert.equal(result.issue.number, 7);
  assert.equal(result.approvalKind, "spec");
  assert.equal(result.missingLabel, "spec-ok");
  assert.equal(
    runner.calls.some((call) => call.command === "git"),
    false,
  );
});

test("runOneIssue returns no-issue when no eligible issue exists and performs no mutations", async () => {
  const config = await makeConfig();
  const runner = createMockRunner((call) => {
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
                issue(2, ["needs-info"]),
                issue(4, ["agent-ready", "in-progress"]),
              ])
            : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.deepEqual(result, { status: "no-issue" });
  assert.equal(runner.calls.length, 2);
});

test("runOneIssue dry-run logs skip diagnostics when automatic selection finds no eligible issue", async () => {
  const config = await makeConfig();
  const runner = createMockRunner((call) => {
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
                issue(2, ["needs-info"], "Needs more detail"),
                issue(4, ["agent-ready", "in-progress"], "Already claimed"),
              ])
            : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.deepEqual(result, { status: "no-issue" });
  const skipEvents = events.filter((event) => event.level === "debug");
  assert.deepEqual(
    skipEvents.map((event) => ({
      message: event.message,
      issueNumber: event.issueNumber,
      data: event.data,
    })),
    [
      {
        message: "skipped #2: blocking labels",
        issueNumber: 2,
        data: {
          issueNumber: 2,
          title: "Needs more detail",
          state: "open",
          labels: ["needs-info"],
          workflowState: "not-actionable",
          reason: "blocking-labels",
          blockingLabels: ["needs-info"],
        },
      },
      {
        message: "skipped #4: blocking labels",
        issueNumber: 4,
        data: {
          issueNumber: 4,
          title: "Already claimed",
          state: "open",
          labels: ["agent-ready", "in-progress"],
          workflowState: "agent-ready",
          reason: "blocking-labels",
          blockingLabels: ["in-progress"],
        },
      },
    ],
  );
  assert.equal(
    events.at(-1)?.message,
    "no eligible issue found after considering 2 open issues; see run log for skip details",
  );
  assert.equal(runner.calls.length, 2);
});

test("runOneIssue targeted GitHub issue reads issue by number", async () => {
  const config = await makeConfig({
    host: { provider: "github-gh", login: "" },
    issueNumber: 1001,
  });
  const runner = createMockRunner((call) => {
    if (
      call.command === "gh" &&
      call.args[0] === "issue" &&
      call.args[1] === "view"
    ) {
      return {
        code: 0,
        stdout: JSON.stringify({
          number: 1001,
          title: "Outside the list cap",
          body: "Implement me",
          state: "OPEN",
          labels: [{ name: "agent-ready" }],
          author: { login: "alice" },
          updatedAt: "2026-05-28T10:00:00Z",
          comments: [],
        }),
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "dry-run");
  assert.equal(result.issue.number, 1001);
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "gh" && call.args.join(" ").startsWith("issue list"),
    ),
    false,
  );
  assert.deepEqual(
    runner.calls.map((call) =>
      [call.command, ...call.args.slice(0, 3)].join(" "),
    ),
    [
      "gh issue view 1001",
      "git rev-parse --verify HEAD^{commit}",
      "git rev-parse --verify refs/remotes/origin/main^{commit}",
      "git log --oneline refs/remotes/origin/main..HEAD",
    ],
  );
});

test("runOneIssue resumes a single in-progress issue with run state before selecting ready issues", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Resume in-progress issue",
      status: "planning",
      planPath: "docs/plans/2026-05-14-issue-45-resume-in-progress-issue.md",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
      },
    },
    NOW.toISOString(),
  );
  await writeFile(
    join(
      config.repoRoot,
      "docs",
      "plans",
      "2026-05-14-issue-45-resume-in-progress-issue.md",
    ),
    "# plan\n",
    "utf8",
  );
  const inProgress = issue(
    45,
    ["in-progress", "bug"],
    "Resume in-progress issue",
  );
  const ready = issue(46, ["agent-ready", "bug"], "New ready issue");
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([inProgress, ready]) : "[]",
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
      assert.match(prompt, /Read AGENTS\.md and the implementation plan at/);
      return {
        code: 0,
        stdout:
          '{"status":"pr-created","prUrl":"https://forgejo.example/pr/45","branch":"agent/issue-45-finished-plan-only","commits":["123abc"],"validation":["npm test"],"reviewSummary":"reviewed"}',
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-found");
  assert.equal(result.issue.number, 45);
  assert.equal(
    result.planPath,
    "docs/plans/2026-05-14-issue-45-resume-in-progress-issue.md",
  );
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.equal(editCalls.length, 1);
  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 1);
  assert.doesNotMatch(commentBody(comments[0]), /Automation started/);
});

test("runOneIssue ignores its own log file in a non-default run-state directory", async () => {
  const baseConfig = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  const config = {
    ...baseConfig,
    runStateDir: join(baseConfig.repoRoot, "logs", "run-state"),
  };
  const planPath = "docs/plans/2026-05-14-issue-45-resume-in-progress-issue.md";
  const logPath = join(config.runStateDir, "run.jsonl");
  assert.ok(!config.cleanStatusIgnorePrefixes?.includes("logs/run-state/"));
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Resume in-progress issue",
      status: "planning",
      planPath,
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
      },
    },
    NOW.toISOString(),
  );
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  const inProgress = issue(
    45,
    ["in-progress", "bug"],
    "Resume in-progress issue",
  );
  const ready = issue(46, ["agent-ready", "bug"], "New ready issue");
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([inProgress, ready]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "?? logs/run-state/run.jsonl\n", stderr: "" };
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
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, {
    now: NOW,
    progress: new JsonlProgressReporter(logPath),
    logPath,
  });

  assert.equal(result.status, "plan-found");
  assert.equal(result.issue.number, 45);
  assert.equal(result.logPath, logPath);
  assert.match(await readFile(logPath, "utf8"), /checking repository status/);
});

test("runOneIssue rejects multiple resumable in-progress issues", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  await writeRunState(
    config.runStateDir,
    { issueNumber: 45, title: "First", status: "planning" },
    NOW.toISOString(),
  );
  await writeRunState(
    config.runStateDir,
    { issueNumber: 46, title: "Second", status: "implementing" },
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
                issue(45, ["in-progress"]),
                issue(46, ["in-progress"]),
              ])
            : "[]",
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Multiple resumable in-progress automation runs found: #45, #46/,
  );
});

test("runOneIssue does not count blocked saved workspace as resumable before recovery inspection", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Blocked saved workspace",
      status: "blocked",
      branch: "agent/issue-45-blocked-saved-workspace",
      worktreePath: ".worktrees/patchmill-issue-45-blocked-saved-workspace",
    },
    NOW.toISOString(),
  );
  const planPath = "docs/plans/2026-05-14-issue-46-resumable-plan.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 46,
      title: "Resumable plan",
      status: "planning",
      planPath,
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
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
                issue(45, ["in-progress"], "Blocked saved workspace"),
                issue(46, ["in-progress"], "Resumable plan"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment")
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-found");
  assert.equal(result.issue.number, 46);
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        (call.args[0] === "show-ref" || call.args[0] === "worktree"),
    ),
    false,
  );
});

test("runOneIssue rejects an explicit open issue that is not agent-ready with a clear message", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 7,
  });
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "7"
    ) {
      return {
        code: 0,
        stdout: issueViewPayload(issue(7, ["bug"])),
        stderr: "",
      };
    }

    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([issue(7, ["bug"])]) : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Issue #7 is open but not labeled agent-ready/,
  );
  assert.equal(runner.calls.length, 3);
});

test("runOneIssue rejects a different explicit issue when a resumable run exists", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 46,
  });
  await writeRunState(
    config.runStateDir,
    { issueNumber: 45, title: "Resume first", status: "planning" },
    NOW.toISOString(),
  );
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "46"
    ) {
      return {
        code: 0,
        stdout: issueViewPayload(
          issue(46, ["agent-ready", "bug"], "Requested issue"),
        ),
        stderr: "",
      };
    }

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
                issue(45, ["in-progress", "bug"], "Resume first"),
                issue(46, ["agent-ready", "bug"], "Requested issue"),
              ])
            : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Resumable in-progress automation run #45 exists; resume it before processing #46/,
  );
});

test("runOneIssue rejects a different explicit blocked recovery issue when a resumable run exists", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
  });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Blocked saved workspace",
      status: "blocked",
      branch: "agent/issue-45-blocked-saved-workspace",
      worktreePath: ".worktrees/patchmill-issue-45-blocked-saved-workspace",
    },
    NOW.toISOString(),
  );
  await writeRunState(
    config.runStateDir,
    { issueNumber: 46, title: "Resume first", status: "planning" },
    NOW.toISOString(),
  );
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "45"
    ) {
      return {
        code: 0,
        stdout: issueViewPayload(
          issue(45, ["in-progress", "bug"], "Blocked saved workspace"),
        ),
        stderr: "",
      };
    }

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
                issue(45, ["in-progress", "bug"], "Blocked saved workspace"),
                issue(46, ["in-progress", "bug"], "Resume first"),
              ])
            : "[]",
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Resumable in-progress automation run #46 exists; resume it before processing #45/,
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        (call.args[0] === "show-ref" || call.args[0] === "worktree"),
    ),
    false,
  );
});

test("runOneIssue allows an explicit resumable issue", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
    issueNumber: 45,
  });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Resume in-progress issue",
      status: "planning",
      planPath: "docs/plans/2026-05-14-issue-45-resume-in-progress-issue.md",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
      },
    },
    NOW.toISOString(),
  );
  await writeFile(
    join(
      config.repoRoot,
      "docs",
      "plans",
      "2026-05-14-issue-45-resume-in-progress-issue.md",
    ),
    "# plan\n",
    "utf8",
  );
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "45"
    ) {
      return {
        code: 0,
        stdout: issueViewPayload(
          issue(45, ["in-progress", "bug"], "Resume in-progress issue"),
        ),
        stderr: "",
      };
    }

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
                issue(45, ["in-progress", "bug"], "Resume in-progress issue"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment")
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-found");
  assert.equal(result.issue.number, 45);
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.equal(editCalls.length, 1);
  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 1);
  assert.doesNotMatch(commentBody(comments[0]), /Automation started/);
});

test("runOneIssue does not reuse finished side-effect checkpoints for a fresh selection", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-finished-plan-only.md";
  await writeFile(
    join(config.plansDir, "2026-05-14-issue-45-finished-plan-only.md"),
    "# plan\n",
    "utf8",
  );
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Finished plan-only",
      status: "finished",
      planPath,
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        readyLabelRestored: true,
        planReadyCommentPosted: true,
        planCreated: true,
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
                issue(45, ["agent-ready", "bug"], "Finished plan-only"),
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
      assert.match(prompt, /Read AGENTS\.md and the implementation plan at/);
      return {
        code: 0,
        stdout:
          '{"status":"pr-created","prUrl":"https://forgejo.example/pr/45","branch":"agent/issue-45-finished-plan-only","commits":["123abc"],"validation":["npm test"],"reviewSummary":"reviewed"}',
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "pr-created");
  assert.equal(result.prUrl, "https://forgejo.example/pr/45");
  const claimCall = runner.calls.find(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit" &&
      call.args.includes("in-progress"),
  );
  assert.ok(claimCall);
  const startComment = runner.calls.find(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "comment" &&
      /Automation started/.test(commentBody(call)),
  );
  assert.ok(startComment);

  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        call.args[0] === "worktree" &&
        call.args[1] === "list",
    ),
    true,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  );
  assert.equal(runState.status, "finished");
  assert.equal(runState.planPath, planPath);
  assert.equal(runState.branch, "agent/issue-45-finished-plan-only");
  assert.equal(
    runState.worktreePath,
    ".worktrees/patchmill-issue-45-finished-plan-only",
  );
  assert.equal(runState.checkpoints.claimed, true);
  assert.equal(runState.checkpoints.startedCommentPosted, true);
  assert.equal(runState.checkpoints.planPathResolved, true);
  assert.equal(runState.checkpoints.planCreated, true);
  assert.equal(runState.checkpoints.worktreeReady, true);
  assert.equal(runState.checkpoints.implementationCompleted, true);
  assert.equal(runState.checkpoints.readyLabelRestored, undefined);
  assert.equal(runState.checkpoints.planReadyCommentPosted, undefined);
});
