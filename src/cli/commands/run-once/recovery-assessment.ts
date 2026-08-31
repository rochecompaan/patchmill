import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { blockingStatusOutput } from "./git.ts";
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
  options: { trim?: boolean } = {},
): Promise<string> {
  const result = await input.runner.run("git", args, { cwd: input.repoRoot });
  if (result.code !== 0) throw failure(label, result);
  return options.trim === false ? result.stdout : result.stdout.trim();
}
async function oid(input: PlanRunRecoveryInput, ref: string): Promise<string> {
  const result = await input.runner.run(
    "git",
    ["rev-parse", "--verify", `${ref}^{commit}`],
    { cwd: input.repoRoot },
  );
  if (result.code !== 0) throw failure(`cannot resolve ${ref}`, result);
  const value = result.stdout.trim();
  if (!/^[0-9a-f]{7,64}$/iu.test(value))
    throw new Error(
      `git returned invalid object id for ${ref}: ${value || "(empty)"}`,
    );
  return value;
}
async function optionalOid(
  input: PlanRunRecoveryInput,
  ref: string,
): Promise<string | undefined> {
  const result = await input.runner.run(
    "git",
    ["rev-parse", "--verify", `${ref}^{commit}`],
    { cwd: input.repoRoot },
  );
  if (result.code === 128) return undefined;
  if (result.code !== 0) throw failure(`cannot resolve ${ref}`, result);
  const value = result.stdout.trim();
  if (!/^[0-9a-f]{7,64}$/iu.test(value))
    throw new Error(
      `git returned invalid object id for ${ref}: ${value || "(empty)"}`,
    );
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
type Registered = {
  path: string;
  branch?: string;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  malformed: boolean;
  seen: boolean;
};

function validBranchName(branch: string): boolean {
  return (
    branch.length > 0 &&
    !/[\x00-\x20\x7f~^:?*\\[\\\\]/u.test(branch) &&
    !branch.includes("..") &&
    !branch.includes("@{") &&
    !branch.endsWith(".") &&
    !branch.endsWith("/") &&
    !branch.startsWith("/") &&
    !branch.includes("//")
  );
}

/** Parse the complete documented porcelain grammar. Any malformed record is
 * global evidence that Git's registration state cannot safely authorize a
 * destructive recovery, even when it is unrelated to this issue's path. */
function registrations(output: string): {
  entries: Registered[];
  malformed: boolean;
} {
  const entries: Registered[] = [];
  let malformed = false;
  let entry: Registered;
  let worktrees: number;
  let heads: number;
  let branchFields: number;
  let detached: number;
  let bares: number;
  let locks: number;
  let prunables: number;
  const reset = () => {
    entry = {
      path: "",
      bare: false,
      locked: false,
      prunable: false,
      malformed: false,
      seen: false,
    };
    worktrees = 0;
    heads = 0;
    branchFields = 0;
    detached = 0;
    bares = 0;
    locks = 0;
    prunables = 0;
  };
  reset();
  const finish = () => {
    if (!entry.seen) return;
    const linked =
      worktrees === 1 &&
      heads === 1 &&
      branchFields + detached === 1 &&
      bares === 0;
    const bare =
      worktrees === 1 &&
      bares === 1 &&
      heads === 0 &&
      branchFields === 0 &&
      detached === 0;
    if (!linked && !bare) entry.malformed = true;
    if (entry.path) entries.push(entry);
    if (entry.malformed) malformed = true;
    reset();
  };
  for (const line of output.split("\n")) {
    if (line === "") {
      finish();
      continue;
    }
    entry.seen = true;
    if (line.startsWith("worktree ")) {
      const path = line.slice("worktree ".length);
      worktrees += 1;
      if (worktrees > 1 || !path || !isAbsolute(path)) entry.malformed = true;
      else entry.path = resolve(path);
    } else if (line.startsWith("HEAD ")) {
      const head = line.slice("HEAD ".length);
      heads += 1;
      if (heads > 1 || !/^[0-9a-f]{7,64}$/iu.test(head)) entry.malformed = true;
    } else if (line.startsWith("branch refs/heads/")) {
      const branch = line.slice("branch refs/heads/".length);
      branchFields += 1;
      if (branchFields > 1 || !validBranchName(branch)) entry.malformed = true;
      else entry.branch = branch;
    } else if (line === "detached") {
      detached += 1;
      if (detached > 1) entry.malformed = true;
    } else if (line === "bare") {
      bares += 1;
      if (bares > 1) entry.malformed = true;
      else entry.bare = true;
    } else if (line === "locked" || /^locked [^\r\n]+$/u.test(line)) {
      locks += 1;
      if (locks > 1) entry.malformed = true;
      else entry.locked = true;
    } else if (line === "prunable" || /^prunable [^\r\n]+$/u.test(line)) {
      prunables += 1;
      if (prunables > 1) entry.malformed = true;
      else entry.prunable = true;
    } else {
      entry.malformed = true;
    }
  }
  finish();
  const paths = new Set<string>();
  const branches = new Set<string>();
  for (const item of entries) {
    if (paths.has(item.path) || (item.branch && branches.has(item.branch)))
      malformed = true;
    paths.add(item.path);
    if (item.branch) branches.add(item.branch);
  }
  return { entries, malformed };
}
function ignoredEntries(status: string): string[] {
  return status
    .split("\n")
    .filter((line) => line.startsWith("!! "))
    .map((line) => line.slice(3));
}
function blocked(state: PlanRunRecoveryInput["state"]): boolean {
  return !!(
    state.status === "blocked" ||
    (state.status === "finished" && state.blockedAt && state.lastError)
  );
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
  expectedBranchElsewhere: boolean;
  expectedBranch: string;
  dirty?: string;
  ignored: string[];
  savedCommits: string[];
  fenced: boolean;
  active: boolean;
  divergence?: { ahead: number; behind: number };
  commits: string[];
  savedBranch?: string;
  savedWorktreePath?: string;
  expectedWorktreePath: string;
  registrationLocked?: boolean;
  registrationsMalformed?: boolean;
}): RunRecoveryClassification {
  if (
    (input.savedBranch && input.savedBranch !== input.expectedBranch) ||
    (input.savedWorktreePath &&
      resolve(input.savedWorktreePath) !==
        resolve(input.expectedWorktreePath)) ||
    (input.worktreeExists && !input.registered) ||
    input.expectedBranchElsewhere ||
    (input.registered && input.registeredBranch !== input.expectedBranch) ||
    (input.worktreeExists && input.registered && !input.registeredBranch) ||
    input.registrationsMalformed ||
    (input.registered && !input.worktreeExists) ||
    (input.registered && input.registrationLocked)
  )
    return "workspace-unverifiable";
  if (input.dirty) return "dirty-worktree";
  if (input.ignored.length) return "ignored-worktree-content";
  if (!input.branchExists && input.savedCommits.length)
    return "unmerged-commits";
  if (input.commits.length || (input.divergence?.ahead ?? 0) > 0)
    return "resumable-with-commits";
  if (input.active && !input.fenced) return "legacy-active-unfenced";
  if (!input.branchExists || !input.worktreeExists) return "recreatable-clean";
  if ((input.divergence?.behind ?? 0) > 0) return "resumable-stale-base";
  return "resumable-current";
}

export async function assessRunRecovery(
  input: PlanRunRecoveryInput,
): Promise<RunRecoveryAssessment> {
  const baseOid = await oid(input, input.baseRef);
  const branchOid = await optionalOid(input, input.expectedWorkspace.branch);
  const worktreePath = resolve(
    input.repoRoot,
    input.expectedWorkspace.worktreePath,
  );
  const worktreeRegistrations = registrations(
    await git(
      input,
      ["worktree", "list", "--porcelain"],
      "cannot list worktrees",
    ),
  );
  const listed = worktreeRegistrations.entries;
  const registered = listed.find((entry) => entry.path === worktreePath);
  const expectedBranchElsewhere = listed.some(
    (entry) =>
      entry.path !== worktreePath &&
      entry.branch === input.expectedWorkspace.branch,
  );
  const worktreeExists = await exists(worktreePath);
  let dirtyStatus: string | undefined;
  let ignoredStatus: string | undefined;
  let ignored: string[] = [];
  if (registered && worktreeExists) {
    const ordinary = await git(
      input,
      ["-C", worktreePath, "status", "--porcelain=v1", "--untracked-files=all"],
      "cannot inspect worktree status",
      { trim: false },
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
      { trim: false },
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
    input.state.leaseProtocolVersion === 1 ||
    (!!input.legacyMigrationFence &&
      active &&
      input.legacyMigrationFence.version === 1 &&
      Number.isSafeInteger(input.legacyMigrationFence.issueNumber) &&
      input.legacyMigrationFence.issueNumber === input.state.issueNumber &&
      ["claimed", "planning", "implementing"].includes(
        input.legacyMigrationFence.status,
      ) &&
      typeof input.legacyMigrationFence.stateSha256 === "string" &&
      /^[a-f0-9]{64}$/u.test(input.legacyMigrationFence.stateSha256) &&
      typeof input.legacyMigrationFence.repairedAt === "string" &&
      !Number.isNaN(Date.parse(input.legacyMigrationFence.repairedAt)) &&
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
    expectedBranchElsewhere,
    expectedBranch: input.expectedWorkspace.branch,
    dirty: dirtyStatus,
    ignored,
    savedCommits,
    fenced: legacyMigrationFenceValid,
    active,
    divergence,
    commits: actualUniqueCommits,
    savedBranch: input.state.branch,
    savedWorktreePath: input.state.worktreePath,
    expectedWorktreePath: input.expectedWorkspace.worktreePath,
    registrationLocked: registered?.locked,
    registrationsMalformed: worktreeRegistrations.malformed,
  });
  return {
    runStatePath: input.runStatePath,
    issueNumber: input.state.issueNumber,
    title: input.state.title,
    status: input.state.status,
    lease: { status: "owned", ownerToken: input.leaseOwnerToken },
    ...(input.state.leaseProtocolVersion === 1
      ? { leaseProtocolVersion: 1 as const }
      : {}),
    legacyMigrationFenceValid,
    blocked: blocked(input.state),
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
