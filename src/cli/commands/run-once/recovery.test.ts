import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatBlockedRunRecoveryReport,
  inspectBlockedRunRecovery,
  planRunRecovery,
  type BlockedRunRecoveryReport,
} from "./recovery.ts";
import { decideRunRecovery } from "./recovery-policy.ts";
import type {
  CommandResult,
  CommandRunner,
  RunRecoveryAssessment,
} from "./types.ts";

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
  options?: { worktreeExists?: boolean; ignoredPaths?: string[] },
) {
  return inspectBlockedRunRecovery({
    runner: cleanRunner(overrides),
    repoRoot: await tempRepo(options),
    runStatePath: ".patchmill/runs/issue-45.json",
    state: baseState,
    baseRef: "main",
    ignoredPaths: options?.ignoredPaths,
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

test("inspectBlockedRunRecovery ignores configured clean-status paths in saved worktree", async () => {
  const report = await inspect(
    { dirtyStatus: "?? .patchmill/runs/issue-45.json\n" },
    { ignoredPaths: [".patchmill/runs/"] },
  );

  assert.equal(report.kind, "recoverable-clean");
  assert.equal(report.worktree.clean, true);
  assert.equal(report.worktree.dirtyStatus, undefined);
});

test("inspectBlockedRunRecovery still blocks non-ignored dirty status with ignored paths configured", async () => {
  const report = await inspect(
    { dirtyStatus: "?? .patchmill/runs/issue-45.json\n M src/index.ts\n" },
    { ignoredPaths: [".patchmill/runs/"] },
  );

  assert.equal(report.kind, "dirty-worktree");
  assert.equal(report.worktree.clean, false);
  assert.equal(report.worktree.dirtyStatus, "M src/index.ts");
});

test("inspectBlockedRunRecovery classifies already merged branch", async () => {
  const report = await inspect({ merged: true, log: "" });

  assert.equal(report.kind, "already-merged");
  assert.equal(report.branch.merged, true);
});

test("inspectBlockedRunRecovery classifies clean behind saved workspace as recoverable", async () => {
  const report = await inspect({ revList: "3\t2\n" });

  assert.equal(report.kind, "recoverable-clean");
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

test("inspectBlockedRunRecovery classifies registered but missing worktree path without status", async () => {
  const runner = cleanRunner();
  const report = await inspectBlockedRunRecovery({
    runner,
    repoRoot: await tempRepo({ worktreeExists: false }),
    runStatePath: ".patchmill/runs/issue-45.json",
    state: baseState,
    baseRef: "main",
  });

  assert.equal(report.kind, "missing-worktree-existing-branch");
  assert.equal(report.branch.exists, true);
  assert.equal(report.worktree.exists, false);
  assert.equal(report.worktree.registered, true);
  assert.match(report.recommendedActions[0] ?? "", /still registered with Git/);
  assert.match(
    report.recommendedActions[1] ?? "",
    /prune or remove the stale worktree registration/,
  );
  assert.doesNotMatch(report.recommendedActions[0] ?? "", /git worktree add/);
  assert.equal(
    runner.calls.some(
      (call) => call.args[0] === "-C" && call.args[2] === "status",
    ),
    false,
  );
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

test("typed recovery decision table selects only conservative actions", () => {
  const assessment = (
    classification: RunRecoveryAssessment["classification"],
  ): RunRecoveryAssessment => ({
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
    worktree: { exists: false, registered: false, ignoredEntries: [] },
    actualUniqueCommits: [],
    savedCommits: [],
    artifacts: { spec: { valid: false }, plan: { valid: false } },
    classification,
  });
  assert.equal(
    decideRunRecovery("retry", assessment("recreatable-clean")).action,
    "recreate-and-resume",
  );
  assert.equal(
    decideRunRecovery("retry", assessment("resumable-current")).action,
    "resume",
  );
  assert.equal(
    decideRunRecovery("retry", assessment("dirty-worktree")).action,
    "refuse",
  );
  assert.equal(
    decideRunRecovery("reset", assessment("resumable-current")).action,
    "archive-reset-and-start",
  );
  assert.equal(
    decideRunRecovery("reset", assessment("resumable-with-commits")).action,
    "refuse",
  );
});

test("locked absent registration is unverifiable rather than pruneable", async () => {
  const root = await tempRepo({ worktreeExists: false });
  const worktree = join(root, "missing-worktree");
  const oid = "0123456789abcdef0123456789abcdef01234567";
  const decision = await planRunRecovery({
    intent: "retry",
    repoRoot: root,
    runStatePath: join(root, "state.json"),
    state: {
      issueNumber: 45,
      title: "Recover",
      status: "blocked",
      branch: "agent/recover",
      worktreePath: worktree,
      createdAt: "x",
      updatedAt: "x",
    },
    baseRef: "HEAD",
    expectedWorkspace: { branch: "agent/recover", worktreePath: worktree },
    leaseOwnerToken: "owner",
    snapshotRaw: "state",
    runner: runnerFor((call) => {
      if (call.args[0] === "rev-parse")
        return { code: 0, stdout: `${oid}\n`, stderr: "" };
      if (call.args.join(" ") === "worktree list --porcelain")
        return {
          code: 0,
          stdout: `worktree ${worktree}\nHEAD ${oid}\nbranch refs/heads/agent/recover\nlocked unavailable\n`,
          stderr: "",
        };
      if (call.args[0] === "rev-list")
        return { code: 0, stdout: "0 0\n", stderr: "" };
      if (call.args[0] === "log") return { code: 0, stdout: "", stderr: "" };
      if (call.args[0] === "cat-file")
        return { code: 1, stdout: "", stderr: "" };
      throw new Error(`unexpected git ${call.args.join(" ")}`);
    }),
  });
  assert.equal(decision.action, "refuse");
  if (decision.action === "refuse")
    assert.equal(decision.reason, "workspace-unverifiable");
});

test("malformed existing worktree registration is unverifiable", async () => {
  const root = await tempRepo();
  const worktree = join(root, baseState.worktreePath);
  const oid = "0123456789abcdef0123456789abcdef01234567";
  const decision = await planRunRecovery({
    intent: "retry",
    repoRoot: root,
    runStatePath: join(root, "state.json"),
    state: { ...baseState, worktreePath: worktree },
    baseRef: "HEAD",
    expectedWorkspace: {
      branch: baseState.branch,
      worktreePath: worktree,
    },
    leaseOwnerToken: "owner",
    snapshotRaw: "state",
    runner: runnerFor((call) => {
      if (call.args[0] === "rev-parse")
        return { code: 0, stdout: `${oid}\n`, stderr: "" };
      if (call.args.join(" ") === "worktree list --porcelain")
        return {
          code: 0,
          stdout: `worktree ${worktree}\nbranch refs/heads/${baseState.branch}\nunknown evidence\n`,
          stderr: "",
        };
      if (call.args[0] === "rev-list")
        return { code: 0, stdout: "0 0\n", stderr: "" };
      if (call.args[0] === "log") return { code: 0, stdout: "", stderr: "" };
      if (call.args[0] === "cat-file")
        return { code: 1, stdout: "", stderr: "" };
      if (call.args[0] === "-C") return { code: 0, stdout: "", stderr: "" };
      throw new Error(`unexpected git ${call.args.join(" ")}`);
    }),
  });
  assert.equal(decision.action, "refuse");
  if (decision.action === "refuse")
    assert.equal(decision.reason, "workspace-unverifiable");
});

test("registered absent worktree is unverifiable and requires manual repair", async () => {
  const root = await tempRepo({ worktreeExists: false });
  const worktree = join(root, baseState.worktreePath);
  const oid = "0123456789abcdef0123456789abcdef01234567";
  const decision = await planRunRecovery({
    intent: "retry",
    repoRoot: root,
    runStatePath: join(root, "state.json"),
    state: { ...baseState, worktreePath: worktree },
    baseRef: "HEAD",
    expectedWorkspace: { branch: baseState.branch, worktreePath: worktree },
    leaseOwnerToken: "owner",
    snapshotRaw: "state",
    runner: runnerFor((call) => {
      if (call.args[0] === "rev-parse")
        return { code: 0, stdout: `${oid}\n`, stderr: "" };
      if (call.args.join(" ") === "worktree list --porcelain")
        return {
          code: 0,
          stdout: `worktree ${worktree}\nHEAD ${oid}\nbranch refs/heads/${baseState.branch}\nprunable missing\n\nworktree ${join(root, "unrelated")}\nHEAD ${oid}\nbranch refs/heads/unrelated\n`,
          stderr: "",
        };
      if (call.args[0] === "rev-list")
        return { code: 0, stdout: "0 0\n", stderr: "" };
      if (call.args[0] === "log") return { code: 0, stdout: "", stderr: "" };
      if (call.args[0] === "cat-file")
        return { code: 1, stdout: "", stderr: "" };
      throw new Error(`unexpected git ${call.args.join(" ")}`);
    }),
  });
  assert.equal(decision.action, "refuse");
  if (decision.action === "refuse") {
    assert.equal(decision.reason, "workspace-unverifiable");
    assert.match(
      decision.guidance.join("\n"),
      /Repair the workspace registration/,
    );
  }
});

test("malformed or duplicate porcelain records anywhere are globally unverifiable", async () => {
  const root = await tempRepo();
  const worktree = join(root, baseState.worktreePath);
  const oid = "0123456789abcdef0123456789abcdef01234567";
  for (const extra of [
    "HEAD detached-without-worktree\n",
    "HEAD malformed-without-worktree\nunknown evidence\n",
    `worktree ${join(root, "other")}\nbranch refs/heads/other\n\nworktree ${join(root, "other")}\nbranch refs/heads/other-again\n`,
  ]) {
    const decision = await planRunRecovery({
      intent: "retry",
      repoRoot: root,
      runStatePath: join(root, "state.json"),
      state: { ...baseState, worktreePath: worktree },
      baseRef: "HEAD",
      expectedWorkspace: { branch: baseState.branch, worktreePath: worktree },
      leaseOwnerToken: "owner",
      snapshotRaw: "state",
      runner: runnerFor((call) => {
        if (call.args[0] === "rev-parse")
          return { code: 0, stdout: `${oid}\n`, stderr: "" };
        if (call.args.join(" ") === "worktree list --porcelain")
          return {
            code: 0,
            stdout: `worktree ${worktree}\nHEAD ${oid}\nbranch refs/heads/${baseState.branch}\n\n${extra}`,
            stderr: "",
          };
        if (call.args[0] === "rev-list")
          return { code: 0, stdout: "0 0\n", stderr: "" };
        if (call.args[0] === "log") return { code: 0, stdout: "", stderr: "" };
        if (call.args[0] === "cat-file" || call.args[0] === "-C")
          return {
            code: call.args[0] === "-C" ? 0 : 1,
            stdout: "",
            stderr: "",
          };
        throw new Error(`unexpected git ${call.args.join(" ")}`);
      }),
    });
    assert.equal(decision.action, "refuse");
    if (decision.action === "refuse")
      assert.equal(decision.reason, "workspace-unverifiable");
  }
});

test("unverifiable workspace guidance identifies saved and expected workspaces", () => {
  const decision = decideRunRecovery("retry", {
    runStatePath: "state",
    issueNumber: 45,
    title: "Recover",
    status: "blocked",
    lease: { status: "owned", ownerToken: "owner" },
    legacyMigrationFenceValid: true,
    blocked: true,
    expectedWorkspace: { branch: "agent/expected", worktreePath: "expected" },
    savedWorkspace: { branch: "agent/saved", worktreePath: "saved" },
    baseOid: "0123456789abcdef0123456789abcdef01234567",
    branch: { exists: true },
    worktree: { exists: false, registered: false, ignoredEntries: [] },
    actualUniqueCommits: [],
    savedCommits: [],
    artifacts: { spec: { valid: false }, plan: { valid: false } },
    classification: "workspace-unverifiable",
  });
  assert.equal(decision.action, "refuse");
  if (decision.action !== "refuse") return;
  assert.match(decision.guidance.join("\n"), /agent\/saved/);
  assert.match(decision.guidance.join("\n"), /agent\/expected/);
});

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

test("formatBlockedRunRecoveryReport distinguishes registered missing worktree guidance", () => {
  const missing = report("missing-worktree-existing-branch");
  missing.worktree.exists = false;
  missing.worktree.registered = true;
  delete missing.worktree.clean;
  missing.recommendedActions = [
    "The saved worktree path .worktrees/patchmill-issue-45-recover-blocked-run is still registered with Git but the path is missing; repair or restore the missing path if local files need preservation.",
    "If no local files need preservation at that path, prune or remove the stale worktree registration, then reattach the saved branch.",
    "After repair, retry with: patchmill run-once --issue 45",
  ];
  const message = formatBlockedRunRecoveryReport(missing);

  assert.match(message, /path missing, registered/);
  assert.match(message, /still registered with Git but the path is missing/);
  assert.match(message, /prune or remove the stale worktree registration/);
  assert.doesNotMatch(
    message.split("Recommended actions:")[1]?.split("\n")[1] ?? "",
    /git worktree add/,
  );
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
