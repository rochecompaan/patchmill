import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { blockingStatusOutput } from "./git.ts";
import { hasBlockedRunRecoveryState } from "./recovery.ts";
import type {
  CommandResult,
  PlanRunRecoveryInput,
  RunRecoveryArtifactAssessment,
  RunRecoveryAssessment,
  RunRecoveryClassification,
} from "./types.ts";

function failure(label: string, result: CommandResult): Error {
  return new Error(
    `${label}: ${[result.stderr, result.stdout].filter(Boolean).join("\n").trim() || `exit ${result.code}`}`,
  );
}
async function git(
  input: PlanRunRecoveryInput,
  args: string[],
  label: string,
): Promise<string> {
  const result = await input.runner.run("git", args, { cwd: input.repoRoot });
  if (result.code !== 0) throw failure(label, result);
  return result.stdout.trim();
}
async function oid(input: PlanRunRecoveryInput, ref: string): Promise<string> {
  const value = await git(
    input,
    ["rev-parse", "--verify", `${ref}^{commit}`],
    `cannot resolve ${ref}`,
  );
  if (!/^[0-9a-f]{7,64}$/iu.test(value))
    throw new Error(`git returned invalid object id for ${ref}`);
  return value;
}
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
type Registered = { path: string; branch?: string };
function registrations(output: string): Registered[] {
  const entries: Registered[] = [];
  let entry: Registered = { path: "" };
  for (const line of output.split("\n")) {
    if (!line) {
      if (entry.path) entries.push(entry);
      entry = { path: "" };
    } else if (line.startsWith("worktree "))
      entry.path = resolve(line.slice(9));
    else if (line.startsWith("branch refs/heads/"))
      entry.branch = line.slice("branch refs/heads/".length);
  }
  if (entry.path) entries.push(entry);
  return entries;
}
function ignoredEntries(status: string): string[] {
  return status
    .split("\n")
    .filter((line) => line.startsWith("!! "))
    .map((line) => line.slice(3));
}
function isActive(
  status: RunRecoveryAssessment["status"],
): status is "claimed" | "planning" | "implementing" {
  return (
    status === "claimed" || status === "planning" || status === "implementing"
  );
}
async function artifact(
  input: PlanRunRecoveryInput,
  path: string | undefined,
  commit: string | undefined,
  baseOid: string,
  published: { path?: string; commit?: string } | undefined,
): Promise<RunRecoveryArtifactAssessment> {
  if (!path) return { valid: false };
  const result = await input.runner.run(
    "git",
    ["cat-file", "-t", `${baseOid}:${path}`],
    { cwd: input.repoRoot },
  );
  if (result.code === 0 && result.stdout.trim() === "blob")
    return { path, commit, valid: true, source: "base" };
  if (
    published?.path === path &&
    (!commit || !published.commit || published.commit === commit)
  )
    return {
      path,
      commit: published.commit ?? commit,
      valid: true,
      source: "published",
    };
  return { path, commit, valid: false };
}
function classify(input: {
  branchExists: boolean;
  worktreeExists: boolean;
  registered: boolean;
  registeredBranch?: string;
  expectedBranch: string;
  dirty?: string;
  ignored: string[];
  savedCommits: string[];
  fenced: boolean;
  active: boolean;
  divergence?: { ahead: number; behind: number };
  commits: string[];
}): RunRecoveryClassification {
  if (
    (input.worktreeExists && !input.registered) ||
    (input.registered && input.registeredBranch !== input.expectedBranch) ||
    (input.worktreeExists && input.registered && !input.registeredBranch)
  )
    return "workspace-unverifiable";
  if (input.dirty) return "dirty-worktree";
  if (input.ignored.length) return "ignored-worktree-content";
  if (!input.branchExists && input.savedCommits.length)
    return "unmerged-commits";
  if (input.active && !input.fenced) return "legacy-active-unfenced";
  if (!input.branchExists || !input.worktreeExists) return "recreatable-clean";
  if (input.commits.length || (input.divergence?.ahead ?? 0) > 0)
    return "resumable-with-commits";
  if ((input.divergence?.behind ?? 0) > 0) return "resumable-stale-base";
  return "resumable-current";
}

export async function assessRunRecovery(
  input: PlanRunRecoveryInput,
): Promise<RunRecoveryAssessment> {
  const baseOid = await oid(input, input.baseRef);
  let branchOid: string | undefined;
  try {
    branchOid = await oid(input, input.expectedWorkspace.branch);
  } catch (error) {
    if (!String(error).includes("exit 1")) throw error;
  }
  const worktreePath = resolve(
    input.repoRoot,
    input.expectedWorkspace.worktreePath,
  );
  const listed = registrations(
    await git(
      input,
      ["worktree", "list", "--porcelain"],
      "cannot list worktrees",
    ),
  );
  const registered = listed.find((entry) => entry.path === worktreePath);
  const worktreeExists = await exists(worktreePath);
  let dirtyStatus: string | undefined;
  let ignoredStatus: string | undefined;
  let ignored: string[] = [];
  if (registered && worktreeExists) {
    const ordinary = await git(
      input,
      ["-C", worktreePath, "status", "--porcelain=v1", "--untracked-files=all"],
      "cannot inspect worktree status",
    );
    dirtyStatus =
      blockingStatusOutput(
        ordinary,
        worktreePath,
        input.ignoredPaths ?? [],
      ).trim() || undefined;
    const all = await git(
      input,
      [
        "-C",
        worktreePath,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignored=matching",
      ],
      "cannot inspect ignored worktree status",
    );
    ignored = ignoredEntries(all);
    ignoredStatus = ignored.length ? all : undefined;
  }
  let divergence: { ahead: number; behind: number } | undefined;
  let actualUniqueCommits: string[] = [];
  if (branchOid) {
    const value = await git(
      input,
      ["rev-list", "--left-right", "--count", `${baseOid}...${branchOid}`],
      "cannot inspect branch divergence",
    );
    const fields = value.split(/\s+/u);
    if (fields.length !== 2 || !fields.every((item) => /^\d+$/u.test(item)))
      throw new Error(
        `git rev-list returned unparseable divergence: ${value || "(empty)"}`,
      );
    divergence = { behind: Number(fields[0]), ahead: Number(fields[1]) };
    const log = await git(
      input,
      ["log", "--oneline", `${baseOid}..${branchOid}`],
      "cannot inspect unique commits",
    );
    actualUniqueCommits = log ? log.split("\n").filter(Boolean) : [];
  }
  const active = isActive(input.state.status);
  const hash = createHash("sha256").update(input.snapshotRaw).digest("hex");
  const legacyMigrationFenceValid =
    !!input.state.leaseProtocolVersion ||
    (!!input.legacyMigrationFence &&
      active &&
      input.legacyMigrationFence.issueNumber === input.state.issueNumber &&
      input.legacyMigrationFence.status === input.state.status &&
      input.legacyMigrationFence.stateSha256 === hash);
  const artifacts = {
    spec: await artifact(
      input,
      input.state.specPath,
      input.state.specCommit,
      baseOid,
      input.resolvedArtifacts?.spec,
    ),
    plan: await artifact(
      input,
      input.state.planPath,
      input.state.planCommit,
      baseOid,
      input.resolvedArtifacts?.plan,
    ),
  };
  const savedCommits = input.state.commits ?? [];
  const classification = classify({
    branchExists: !!branchOid,
    worktreeExists,
    registered: !!registered,
    registeredBranch: registered?.branch,
    expectedBranch: input.expectedWorkspace.branch,
    dirty: dirtyStatus,
    ignored,
    savedCommits,
    fenced: legacyMigrationFenceValid,
    active,
    divergence,
    commits: actualUniqueCommits,
  });
  return {
    runStatePath: input.runStatePath,
    issueNumber: input.state.issueNumber,
    title: input.state.title,
    status: input.state.status,
    lease: { status: "owned", ownerToken: input.leaseOwnerToken },
    ...(input.state.leaseProtocolVersion
      ? { leaseProtocolVersion: 1 as const }
      : {}),
    legacyMigrationFenceValid,
    blocked: hasBlockedRunRecoveryState(input.state),
    ...(input.state.checkpoints?.startedCommentPosted
      ? { startedCommentPosted: true as const }
      : {}),
    blockerReason: input.state.lastError,
    blockerQuestions: input.state.blockerQuestions,
    expectedWorkspace: input.expectedWorkspace,
    savedWorkspace: {
      branch: input.state.branch,
      worktreePath: input.state.worktreePath,
    },
    baseOid,
    branch: {
      exists: !!branchOid,
      ...(branchOid ? { oid: branchOid } : {}),
      ...(registered?.path ? { checkedOutAt: registered.path } : {}),
    },
    worktree: {
      exists: worktreeExists,
      registered: !!registered,
      ...(registered?.branch ? { registeredBranch: registered.branch } : {}),
      ...(registered && worktreeExists
        ? {
            clean: !dirtyStatus && ignored.length === 0,
            dirtyStatus,
            ignoredStatus,
          }
        : {}),
      ignoredEntries: ignored,
    },
    divergence,
    actualUniqueCommits,
    savedCommits,
    artifacts,
    classification,
  };
}
