import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planRunRecovery } from "./recovery.ts";
import { decideRunRecovery } from "./recovery-policy.ts";

async function planRecovery(ordinaryStatus = "", revList = "0\t0\n", log = "") {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-ignored-recovery-"));
  const worktreePath = join(repoRoot, "work");
  await mkdir(worktreePath);
  try {
    return await planRunRecovery({
      intent: "retry",
      repoRoot,
      runner: {
        async run(_command, args) {
          if (args.some((arg) => arg.startsWith("--ignored")))
            return {
              code: 1,
              stdout: "",
              stderr: "ignored status unavailable",
            };
          let stdout: string;
          if (args.includes("rev-parse")) stdout = "a".repeat(40);
          else if (args.join(" ") === "worktree list --porcelain")
            stdout = `worktree ${worktreePath}\nHEAD ${"a".repeat(40)}\nbranch refs/heads/agent/recover\n\n`;
          else if (args.includes("status")) stdout = ordinaryStatus;
          else if (args[0] === "rev-list") stdout = revList;
          else if (args[0] === "log") stdout = log;
          else throw new Error(`unexpected git ${args.join(" ")}`);
          return { code: 0, stdout, stderr: "" };
        },
      },
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
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

test("recovery never requests ignored status for resume, refresh, or reset", async () => {
  const current = await planRecovery();
  assert.equal(current.action, "resume");
  assert.equal(current.assessment.worktree.ordinaryClean, true);
  const stale = await planRecovery("", "3\t0\n");
  assert.equal(stale.action, "refresh-and-resume");
  const reset = decideRunRecovery("reset", current.assessment, {
    quarantinePath: "quarantine",
    stagingPath: "staging",
  });
  assert.equal(reset.action, "archive-reset-and-start");
});

test("ordinary changes and unique commits still refuse recovery", async () => {
  const dirty = await planRecovery(" M src/index.ts\n");
  assert.equal(dirty.action, "refuse");
  if (dirty.action === "refuse") assert.equal(dirty.reason, "dirty-worktree");
  const commits = await planRecovery("", "0\t1\n", "abc123 implement\n");
  assert.equal(commits.action, "resume");
  const reset = decideRunRecovery("reset", commits.assessment, {
    quarantinePath: "quarantine",
    stagingPath: "staging",
  });
  assert.equal(reset.action, "refuse");
  if (reset.action === "refuse") assert.equal(reset.reason, "unmerged-commits");
});
