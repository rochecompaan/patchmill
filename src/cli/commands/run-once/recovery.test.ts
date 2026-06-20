import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatBlockedRunRecoveryReport,
  inspectBlockedRunRecovery,
  type BlockedRunRecoveryReport,
} from "./recovery.ts";
import type { CommandResult, CommandRunner } from "./types.ts";

type Call = { command: string; args: string[]; cwd?: string };

function runnerFor(
  handler: (call: Call) => CommandResult,
): CommandRunner & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async run(command, args, options = {}) {
      const call = { command, args: [...args], cwd: options.cwd };
      calls.push(call);
      return handler(call);
    },
  };
}

const baseState = {
  issueNumber: 45,
  title: "Recover blocked run",
  status: "blocked" as const,
  branch: "agent/issue-45-recover-blocked-run",
  worktreePath: ".worktrees/patchmill-issue-45-recover-blocked-run",
  commits: ["abc123", "def456"],
  lastError: "Required verification environment is unavailable.",
  createdAt: "2026-06-20T08:00:00.000Z",
  updatedAt: "2026-06-20T08:10:00.000Z",
};

async function tempRepo(options: { worktreeExists?: boolean } = {}) {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-recovery-"));
  if (options.worktreeExists !== false) {
    await mkdir(join(repoRoot, baseState.worktreePath), { recursive: true });
  }
  return repoRoot;
}

function cleanRunner(
  overrides: Partial<{
    branchExists: boolean;
    worktreeRegistered: boolean;
    dirtyStatus: string;
    merged: boolean;
    revList: string;
    log: string;
  }> = {},
) {
  return runnerFor((call) => {
    if (call.args[0] === "show-ref") {
      return {
        code: overrides.branchExists === false ? 1 : 0,
        stdout: "",
        stderr: "",
      };
    }
    if (call.args.join(" ") === "worktree list --porcelain") {
      return {
        code: 0,
        stdout:
          overrides.worktreeRegistered === false
            ? ""
            : `worktree ${join(call.cwd ?? "/repo", baseState.worktreePath)}\nbranch refs/heads/agent/issue-45-recover-blocked-run\n`,
        stderr: "",
      };
    }
    if (call.args[0] === "-C" && call.args[2] === "status") {
      return { code: 0, stdout: overrides.dirtyStatus ?? "", stderr: "" };
    }
    if (call.args[0] === "merge-base") {
      return { code: overrides.merged ? 0 : 1, stdout: "", stderr: "" };
    }
    if (call.args[0] === "rev-list") {
      return { code: 0, stdout: overrides.revList ?? "0\t2\n", stderr: "" };
    }
    if (call.args[0] === "log") {
      return {
        code: 0,
        stdout:
          overrides.log ??
          "def456 add verification\nabc123 implement feature\n",
        stderr: "",
      };
    }
    throw new Error(`unexpected command: git ${call.args.join(" ")}`);
  });
}

async function inspect(
  overrides?: Parameters<typeof cleanRunner>[0],
  options?: { worktreeExists?: boolean },
) {
  return inspectBlockedRunRecovery({
    runner: cleanRunner(overrides),
    repoRoot: await tempRepo(options),
    runStatePath: ".patchmill/runs/issue-45.json",
    state: baseState,
    baseRef: "main",
  });
}

test("inspectBlockedRunRecovery classifies clean unmerged saved workspace as recoverable", async () => {
  const report = await inspect();

  assert.equal(report.kind, "recoverable-clean");
  assert.equal(report.branch.exists, true);
  assert.equal(report.worktree.exists, true);
  assert.equal(report.worktree.clean, true);
  assert.deepEqual(report.divergence, { ahead: 2, behind: 0 });
});

test("inspectBlockedRunRecovery classifies dirty saved worktree", async () => {
  const report = await inspect({
    dirtyStatus: " M src/index.ts\n?? tmp.txt\n",
  });

  assert.equal(report.kind, "dirty-worktree");
  assert.equal(report.worktree.clean, false);
  assert.match(report.worktree.dirtyStatus ?? "", /src\/index\.ts/);
});

test("inspectBlockedRunRecovery classifies already merged branch", async () => {
  const report = await inspect({ merged: true, log: "" });

  assert.equal(report.kind, "already-merged");
  assert.equal(report.branch.merged, true);
});

test("inspectBlockedRunRecovery classifies diverged branch", async () => {
  const report = await inspect({ revList: "3\t2\n" });

  assert.equal(report.kind, "diverged");
  assert.deepEqual(report.divergence, { ahead: 2, behind: 3 });
});

test("inspectBlockedRunRecovery classifies missing worktree with existing branch", async () => {
  const report = await inspect(
    { worktreeRegistered: false },
    { worktreeExists: false },
  );

  assert.equal(report.kind, "missing-worktree-existing-branch");
  assert.equal(report.branch.exists, true);
  assert.equal(report.worktree.exists, false);
  assert.equal(report.worktree.registered, false);
});

test("inspectBlockedRunRecovery classifies missing branch and worktree", async () => {
  const runner = cleanRunner({
    branchExists: false,
    worktreeRegistered: false,
  });
  const report = await inspectBlockedRunRecovery({
    runner,
    repoRoot: await tempRepo({ worktreeExists: false }),
    runStatePath: ".patchmill/runs/issue-45.json",
    state: baseState,
    baseRef: "main",
  });

  assert.equal(report.kind, "missing-branch-or-worktree");
  assert.equal(report.branch.exists, false);
  assert.equal(report.worktree.registered, false);
  assert.equal(report.worktree.exists, false);
});

test("inspectBlockedRunRecovery distinguishes unregistered existing saved path", async () => {
  const report = await inspect({ worktreeRegistered: false });

  assert.equal(report.kind, "missing-worktree-existing-branch");
  assert.equal(report.worktree.exists, true);
  assert.equal(report.worktree.registered, false);
  assert.match(
    report.recommendedActions[0] ?? "",
    /exists but is not registered/,
  );
});

test("inspectBlockedRunRecovery fails fast on unparseable divergence", async () => {
  await assert.rejects(
    () => inspect({ revList: "unexpected output\n" }),
    /unparseable divergence/,
  );
});

function report(
  kind: BlockedRunRecoveryReport["kind"],
): BlockedRunRecoveryReport {
  const common: BlockedRunRecoveryReport = {
    kind,
    runStatePath: ".patchmill/runs/issue-45.json",
    issueNumber: 45,
    title: "Recover blocked run",
    status: "blocked",
    blockerReason: "Required verification environment is unavailable.",
    branch: {
      name: "agent/issue-45-recover-blocked-run",
      exists: true,
      merged: false,
    },
    worktree: {
      path: ".worktrees/patchmill-issue-45-recover-blocked-run",
      exists: true,
      registered: true,
      clean: true,
    },
    divergence: { ahead: 2, behind: 0 },
    commits: ["def456 add verification", "abc123 implement feature"],
    recommendedActions: [],
  };
  const actions: Record<BlockedRunRecoveryReport["kind"], string[]> = {
    "recoverable-clean": [
      "Retry after the external prerequisite is fixed with: patchmill run-once --issue 45",
    ],
    "dirty-worktree": [
      "Commit, stash, or clean local modifications in the saved worktree before retrying.",
    ],
    "already-merged": [
      "Confirm the work is landed, then clean/finalize stale run state.",
    ],
    diverged: [
      "Rebase or cherry-pick the saved work onto the current base, then retry.",
    ],
    "missing-worktree-existing-branch": [
      "Reattach the saved branch with: git worktree add .worktrees/patchmill-issue-45-recover-blocked-run agent/issue-45-recover-blocked-run",
    ],
    "missing-branch-or-worktree": [
      "Archive or remove stale run state only after confirming no saved branch or worktree needs preservation.",
    ],
    "not-blocked-recovery": [
      "No blocked run workspace recovery is available for this state.",
    ],
  };
  return { ...common, recommendedActions: actions[kind] };
}

test("formatBlockedRunRecoveryReport includes clean recovery details", () => {
  const message = formatBlockedRunRecoveryReport(report("recoverable-clean"));

  assert.match(
    message,
    /Issue #45 has a blocked run with preserved workspace state\./,
  );
  assert.match(message, /Run state: \.patchmill\/runs\/issue-45\.json/);
  assert.match(
    message,
    /Blocked reason: Required verification environment is unavailable\./,
  );
  assert.match(
    message,
    /Saved branch: agent\/issue-45-recover-blocked-run \(exists, unmerged, ahead 2, behind 0\)/,
  );
  assert.match(
    message,
    /Saved worktree: \.worktrees\/patchmill-issue-45-recover-blocked-run \(path exists, registered, clean\)/,
  );
  assert.match(message, /def456 add verification/);
  assert.match(message, /patchmill run-once --issue 45/);
});

test("formatBlockedRunRecoveryReport includes dirty recovery guidance", () => {
  const dirty = report("dirty-worktree");
  dirty.worktree.clean = false;
  dirty.worktree.dirtyStatus = " M src/index.ts";
  const message = formatBlockedRunRecoveryReport(dirty);

  assert.match(message, /dirty/i);
  assert.match(message, /Commit, stash, or clean local modifications/);
  assert.doesNotMatch(
    message.split("Recommended actions:")[1] ?? "",
    /^- delete/i,
  );
});

test("formatBlockedRunRecoveryReport includes merged recovery guidance", () => {
  const merged = report("already-merged");
  merged.branch.merged = true;
  const message = formatBlockedRunRecoveryReport(merged);

  assert.match(message, /exists, merged/);
  assert.match(message, /Confirm the work is landed/);
});

test("formatBlockedRunRecoveryReport includes diverged recovery guidance", () => {
  const diverged = report("diverged");
  diverged.divergence = { ahead: 2, behind: 3 };
  const message = formatBlockedRunRecoveryReport(diverged);

  assert.match(message, /ahead 2, behind 3/);
  assert.match(message, /Rebase or cherry-pick/);
});

test("formatBlockedRunRecoveryReport includes missing worktree recovery guidance", () => {
  const missing = report("missing-worktree-existing-branch");
  missing.worktree.exists = false;
  missing.worktree.registered = false;
  delete missing.worktree.clean;
  const message = formatBlockedRunRecoveryReport(missing);

  assert.match(message, /path missing, not registered/);
  assert.match(message, /git worktree add/);
});

test("formatBlockedRunRecoveryReport includes missing branch and worktree recovery guidance", () => {
  const missing = report("missing-branch-or-worktree");
  missing.branch.exists = false;
  missing.worktree.exists = false;
  missing.worktree.registered = false;
  delete missing.worktree.clean;
  const message = formatBlockedRunRecoveryReport(missing);

  assert.match(message, /Saved branch: .*\(missing/);
  assert.match(message, /Archive or remove stale run state/);
});
