import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatRunRecoveryDecision, planRunRecovery } from "./recovery.ts";
import { decideRunRecovery } from "./recovery-policy.ts";
import type {
  CommandResult,
  CommandRunner,
  RunRecoveryAssessment,
} from "./types.ts";

type Call = { command: string; args: string[]; cwd?: string };

async function planRecovery(
  overrides: Partial<{
    ordinaryStatus: string;
    ignoredStatus: string;
    revList: string;
    log: string;
  }> = {},
) {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-ignored-recovery-"));
  const worktreePath = join(repoRoot, "work");
  await mkdir(worktreePath);
  const runner: CommandRunner = {
    async run(command, args, options = {}): Promise<CommandResult> {
      const call: Call = { command, args, cwd: options.cwd };
      if (call.args[0] === "rev-parse")
        return {
          code: 0,
          stdout: call.args.at(-1)?.includes("agent/recover")
            ? "abcdefabcdefabcdefabcdefabcdefabcdefabcd\n"
            : "0123456789abcdef0123456789abcdef01234567\n",
          stderr: "",
        };
      if (call.args.join(" ") === "worktree list --porcelain")
        return {
          code: 0,
          stdout: `worktree ${worktreePath}\nHEAD abcdefabcdefabcdefabcdefabcdefabcdefabcd\nbranch refs/heads/agent/recover\n\n`,
          stderr: "",
        };
      if (call.args[0] === "-C" && call.args[2] === "status")
        return {
          code: 0,
          stdout: call.args.includes("--ignored=matching")
            ? (overrides.ignoredStatus ?? "")
            : (overrides.ordinaryStatus ?? ""),
          stderr: "",
        };
      if (call.args[0] === "rev-list")
        return { code: 0, stdout: overrides.revList ?? "0\t0\n", stderr: "" };
      if (call.args[0] === "log")
        return { code: 0, stdout: overrides.log ?? "", stderr: "" };
      if (call.args[0] === "cat-file")
        return { code: 1, stdout: "", stderr: "" };
      throw new Error(`unexpected git ${call.args.join(" ")}`);
    },
  };
  return planRunRecovery({
    intent: "retry",
    runner,
    repoRoot,
    runStatePath: join(repoRoot, "state.json"),
    state: {
      issueNumber: 45,
      title: "Recover",
      status: "blocked",
      branch: "agent/recover",
      worktreePath,
      createdAt: "x",
      updatedAt: "x",
    },
    baseRef: "HEAD",
    expectedWorkspace: { branch: "agent/recover", worktreePath },
    leaseOwnerToken: "owner",
    snapshotRaw: "state",
    recoveryPaths: { quarantinePath: "quarantine", stagingPath: "staging" },
  });
}

test("current blocked retry preserves ignored workflow state in place", async () => {
  const decision = await planRecovery({
    ignoredStatus:
      "!! .pi/todos/issue-211-task.md\n" +
      "!! .superpowers/single-writer/progress.md\n",
  });
  assert.equal(decision.action, "resume");
  assert.equal(decision.assessment.classification, "resumable-current");
  assert.equal(decision.assessment.worktree.ordinaryClean, true);
  assert.deepEqual(decision.assessment.worktree.ignoredEntries, [
    ".pi/todos/issue-211-task.md",
    ".superpowers/single-writer/progress.md",
  ]);
  assert.match(
    formatRunRecoveryDecision(decision),
    /resuming in place without workspace mutation; preserving ignored entries/,
  );
});

test("commit-bearing blocked retry preserves unknown ignored content in place", async () => {
  const decision = await planRecovery({
    revList: "3\t2\n",
    log: "def456 verify recovery\nabc123 implement recovery\n",
    ignoredStatus: "!! .cache/generated.bin\n",
  });
  assert.equal(decision.action, "resume");
  assert.equal(decision.assessment.classification, "resumable-with-commits");
  assert.deepEqual(decision.assessment.divergence, { behind: 3, ahead: 2 });
});

test("ordinary dirtiness still refuses before ignored preservation", async () => {
  const decision = await planRecovery({
    ordinaryStatus: " M src/index.ts\n",
    ignoredStatus: "!! .cache/generated.bin\n",
  });
  assert.equal(decision.action, "refuse");
  if (decision.action === "refuse")
    assert.equal(decision.reason, "dirty-worktree");
});

test("ignored content blocks a stale refresh with its candidate action", async () => {
  const decision = await planRecovery({
    revList: "3\t0\n",
    ignoredStatus: "!! .cache/generated.bin\n",
  });
  assert.equal(decision.action, "refuse");
  if (decision.action === "refuse") {
    assert.equal(decision.reason, "ignored-worktree-content");
    assert.equal(decision.blockedAction, "refresh-and-resume");
    const message = formatRunRecoveryDecision(decision);
    assert.match(
      message,
      /refresh-and-resume cannot prove ignored content will survive/,
    );
    assert.match(message, /\.cache\/generated\.bin/);
    assert.doesNotMatch(message, /resuming in place/);
  }
});

test("ignored content blocks reset before mutation", async () => {
  const retry = await planRecovery({
    ignoredStatus: "!! .cache/generated.bin\n",
  });
  const decision = decideRunRecovery("reset", retry.assessment, {
    quarantinePath: "quarantine",
    stagingPath: "staging",
  });
  assert.equal(decision.action, "refuse");
  if (decision.action === "refuse") {
    assert.equal(decision.reason, "ignored-worktree-content");
    assert.equal(decision.blockedAction, "archive-reset-and-start");
  }
});

test("reset unique-commit refusal takes precedence over ignored content", async () => {
  const retry = await planRecovery({
    revList: "0\t1\n",
    log: "abc123 implement\n",
    ignoredStatus: "!! .cache/generated.bin\n",
  });
  const decision = decideRunRecovery("reset", retry.assessment, {
    quarantinePath: "quarantine",
    stagingPath: "staging",
  });
  assert.equal(decision.action, "refuse");
  if (decision.action === "refuse")
    assert.equal(decision.reason, "unmerged-commits");
});

test("ignored content blocks recreation regardless of path", () => {
  const assessment = {
    runStatePath: "state",
    issueNumber: 45,
    title: "Recover",
    status: "blocked",
    lease: { status: "owned", ownerToken: "owner" },
    legacyMigrationFenceValid: true,
    blocked: true,
    expectedWorkspace: { branch: "agent/recover", worktreePath: "work" },
    savedWorkspace: {},
    baseOid: "0123456789abcdef0123456789abcdef01234567",
    branch: { exists: false },
    worktree: {
      exists: false,
      registered: false,
      ignoredEntries: [".superpowers/state", ".cache/generated.bin"],
    },
    actualUniqueCommits: [],
    savedCommits: [],
    artifacts: { spec: { valid: false }, plan: { valid: false } },
    classification: "recreatable-clean",
  } satisfies RunRecoveryAssessment;
  const decision = decideRunRecovery("retry", assessment, {
    quarantinePath: "quarantine",
    stagingPath: "staging",
  });
  assert.equal(decision.action, "refuse");
  if (decision.action === "refuse") {
    assert.equal(decision.reason, "ignored-worktree-content");
    assert.equal(decision.blockedAction, "recreate-and-resume");
  }
});
