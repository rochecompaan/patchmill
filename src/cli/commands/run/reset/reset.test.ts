import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { resetIssueRun, validateResetIssueEligibility } from "./reset.ts";
import {
  configuredWorktreeStrategy,
  expectedIssueWorkspace,
} from "../../run-once/pipeline-workspace.ts";
import { writeRunState } from "../../run-once/run-state.ts";
import {
  blockedRecoveryRunner,
  makeConfig,
} from "../../../../../test-support/run-once/pipeline-fixtures.ts";
const NOW = new Date("2026-06-20T12:00:00.000Z");
import type {
  AgentIssueConfig,
  AgentIssueRunState,
  IssueSummary,
} from "../../run-once/types.ts";
const config = {
  readyLabel: "agent-ready",
  approvalPolicy: {
    specApproval: {
      required: false,
      reviewLabel: "spec-review",
      approvedLabel: "spec-approved",
    },
    planApproval: {
      required: false,
      reviewLabel: "plan-review",
      approvedLabel: "plan-approved",
    },
  },
  triagePolicy: {
    labels: {
      ready: "agent-ready",
      inProgress: "in-progress",
      done: "agent-done",
      needsInfo: "needs-info",
    },
  },
} as AgentIssueConfig;
const issue = (labels: string[], state: "open" | "closed" = "open") =>
  ({ number: 45, title: "Recover", state, labels }) as IssueSummary;
const run = (
  status: AgentIssueRunState["status"],
  extra: Partial<AgentIssueRunState> = {},
) =>
  ({
    issueNumber: 45,
    title: "Recover",
    status,
    createdAt: "x",
    updatedAt: "x",
    ...extra,
  }) as AgentIssueRunState;
test("allows active saved statuses only with in-progress", () => {
  for (const status of ["claimed", "planning", "implementing"] as const)
    assert.doesNotThrow(() =>
      validateResetIssueEligibility({
        issue: issue(["in-progress"]),
        state: run(status),
        config,
      }),
    );
});
test("requires agent-ready for blocked and blocked-finished recovery", () => {
  for (const state of [
    run("blocked"),
    run("finished", { blockedAt: "x", lastError: "x" }),
  ]) {
    assert.throws(
      () =>
        validateResetIssueEligibility({
          issue: issue(["needs-info"]),
          state,
          config,
        }),
      /not eligible/,
    );
    assert.doesNotThrow(() =>
      validateResetIssueEligibility({
        issue: issue(["agent-ready", "needs-info"]),
        state,
        config,
      }),
    );
  }
});
test("allows normal finished state with ready or in-progress", () => {
  for (const label of ["agent-ready", "in-progress"])
    assert.doesNotThrow(() =>
      validateResetIssueEligibility({
        issue: issue([label]),
        state: run("finished"),
        config,
      }),
    );
});
test("rejects closed issues and wrong active labels before mutation", () => {
  assert.throws(
    () =>
      validateResetIssueEligibility({
        issue: issue(["in-progress"], "closed"),
        state: run("blocked"),
        config,
      }),
    /not open/,
  );
  assert.throws(
    () =>
      validateResetIssueEligibility({
        issue: issue(["agent-ready"]),
        state: run("implementing"),
        config,
      }),
    /not eligible/,
  );
});
test("allows absent state so reset can provide guidance", () =>
  assert.doesNotThrow(() =>
    validateResetIssueEligibility({ issue: issue([]), config }),
  ));
test("reset archives a registered checkout then enters the pipeline with its borrowed lease", async () => {
  for (const [status, labels] of [
    ["blocked", ["agent-ready", "needs-info"]],
    ["finished", ["in-progress"]],
  ] as const) {
    const runConfig = await makeConfig({
      dryRun: false,
      execute: true,
      issueNumber: 45,
      baseRef: "HEAD",
    });
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: runConfig.repoRoot, encoding: "utf8" });
    git("init");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    await writeFile(join(runConfig.repoRoot, "base"), "base\n");
    git("add", ".");
    git("commit", "-m", "base");
    const workspace = expectedIssueWorkspace(
      45,
      "Recover",
      configuredWorktreeStrategy(runConfig),
    );
    const worktreePath = join(runConfig.repoRoot, workspace.worktreePath);
    git("worktree", "add", "-b", workspace.branch, worktreePath, "HEAD");
    const original = await writeRunState(runConfig.runStateDir, {
      issueNumber: 45,
      title: "Recover",
      status,
      branch: workspace.branch,
      worktreePath: workspace.worktreePath,
      ...(status === "blocked" ? { lastError: "blocked" } : {}),
    });
    const issue = {
      number: 45,
      title: "Recover",
      state: "open" as const,
      labels: [...labels],
      comments: [],
    };
    const runner = {
      async run(_command: string, args: string[], options?: { cwd?: string }) {
        try {
          return {
            code: 0,
            stdout: execFileSync("git", args, {
              cwd: options?.cwd ?? runConfig.repoRoot,
              encoding: "utf8",
            }),
            stderr: "",
          };
        } catch (error) {
          const result = error as {
            status?: number;
            stdout?: string;
            stderr?: string;
          };
          return {
            code: result.status ?? 1,
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
          };
        }
      },
    };
    const calls: unknown[] = [];
    const result = await resetIssueRun(
      runner,
      runConfig,
      { now: NOW },
      {
        createHost: (() => ({
          viewIssue: async () => issue,
          hydrateIssueComments: async () => [issue],
          trustedTriageCommentAuthors: async () => [],
        })) as never,
        runPipeline: async (_runner, _config, options) => {
          calls.push(options);
          return { status: "no-issue" } as never;
        },
      },
    );
    assert.equal(result.status, "reset-started");
    assert.equal(calls.length, 1);
    assert.equal(
      (calls[0] as { lease?: unknown }).lease,
      (calls[0] as { reset?: { lease: unknown } }).reset?.lease,
    );
    assert.equal(
      (calls[0] as { reset?: { seed: { startedCommentPosted?: boolean } } })
        .reset?.seed.startedCommentPosted,
      original.checkpoints?.startedCommentPosted,
    );
    assert.match(
      await (
        await import("node:fs/promises")
      ).readFile(join(result.archivePath, "run-state.json"), "utf8"),
      /"status"/,
    );
    assert.equal(issue.labels.includes("needs-info"), status === "blocked");
  }
});
test("returns absent-state guidance without recovery mutation", async () => {
  const runConfig = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
  });
  const runner = blockedRecoveryRunner(runConfig);
  const result = await resetIssueRun(runner, runConfig, { now: NOW });
  assert.equal(result.status, "nothing-to-reset");
  assert.equal(
    runner.calls.some((call) => call.command === "git"),
    false,
  );
  assert.match(result.guidance, /run-once --issue 45/);
});
