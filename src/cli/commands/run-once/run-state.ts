import { open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AgentIssueRunState,
  AgentIssueRunStateStatus,
  AgentIssueRunStateUpdate,
  IssueRunLease,
  RunResetSeed,
  RunStateSnapshot,
} from "./types.ts";
import { createHash, randomUUID } from "node:crypto";
import { assertIssueRunLeaseOwned } from "./recovery-lease.ts";
import {
  assertImplementationPrEvidence,
  assertImplementationMergeEvidence,
} from "../../../workflow/implementation-pr-evidence.ts";

const STATUS_TIMESTAMPS: Record<
  AgentIssueRunStateStatus,
  keyof AgentIssueRunState
> = {
  claimed: "claimedAt",
  planning: "planningAt",
  implementing: "implementingAt",
  blocked: "blockedAt",
  finished: "finishedAt",
};

export function runStatePath(runStateDir: string, issueNumber: number): string {
  return join(runStateDir, `issue-${issueNumber}.json`);
}

export async function readRunState(
  runStateDir: string,
  issueNumber: number,
): Promise<AgentIssueRunState | undefined> {
  return (await readRunStateSnapshot(runStateDir, issueNumber))?.state;
}

function mergeCheckpoints(
  existing: AgentIssueRunState["checkpoints"],
  update: AgentIssueRunStateUpdate["checkpoints"],
): AgentIssueRunState["checkpoints"] {
  const merged: NonNullable<AgentIssueRunState["checkpoints"]> = {
    ...(existing ?? {}),
  };

  for (const [checkpoint, completed] of Object.entries(update ?? {})) {
    if (completed === true) {
      merged[
        checkpoint as keyof NonNullable<AgentIssueRunState["checkpoints"]>
      ] = true;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeUniqueKeys(
  existing: AgentIssueRunState["failureCommentKeys"],
  update: AgentIssueRunStateUpdate["failureCommentKeys"],
): AgentIssueRunState["failureCommentKeys"] {
  const merged = new Set([...(existing ?? []), ...(update ?? [])]);
  return merged.size > 0 ? [...merged] : undefined;
}

function blockerQuestionsUpdate(
  existing: AgentIssueRunState["blockerQuestions"],
  update: AgentIssueRunStateUpdate["blockerQuestions"],
  clear: boolean | undefined,
): AgentIssueRunState["blockerQuestions"] {
  return clear ? undefined : (update ?? existing);
}

function mergeRunState(
  existing: AgentIssueRunState | undefined,
  update: AgentIssueRunStateUpdate,
  now: string,
): AgentIssueRunState {
  const title = update.title ?? existing?.title;
  if (!title) {
    throw new Error(
      `Run state for issue #${update.issueNumber} requires a title`,
    );
  }

  let checkpoints = mergeCheckpoints(
    update.resetCheckpoints ? undefined : existing?.checkpoints,
    update.checkpoints,
  );
  const existingImplementation = update.resetCheckpoints ? undefined : existing;
  const hasImplementationUpdate = [
    "implementationStatus",
    "prUrl",
    "mergeCommit",
    "commits",
    "validation",
    "reviewSummary",
    "landingDecision",
    "runCostReport",
    "visualEvidence",
  ].some((key) => Object.hasOwn(update, key));
  const implementationStatus = hasImplementationUpdate
    ? update.implementationStatus
    : existingImplementation?.implementationStatus;
  const prUrl = update.prUrl ?? existingImplementation?.prUrl;
  const mergeCommit =
    update.implementationStatus === "pr-created"
      ? undefined
      : hasImplementationUpdate
        ? update.mergeCommit
        : existingImplementation?.mergeCommit;
  const commits = hasImplementationUpdate
    ? update.commits
    : existingImplementation?.commits;
  const validation = hasImplementationUpdate
    ? update.validation
    : existingImplementation?.validation;
  const reviewSummary = hasImplementationUpdate
    ? update.reviewSummary
    : existingImplementation?.reviewSummary;
  const landingDecision = hasImplementationUpdate
    ? update.landingDecision
    : existingImplementation?.landingDecision;
  const runCostReport =
    update.implementationStatus === "merged"
      ? undefined
      : hasImplementationUpdate
        ? update.runCostReport
        : existingImplementation?.runCostReport;
  const visualEvidence = hasImplementationUpdate
    ? update.visualEvidence
    : existingImplementation?.visualEvidence;
  const existingHandoffCommentPosted =
    !update.resetCheckpoints &&
    (existing?.handoffCommentPosted === true ||
      existing?.checkpoints?.handoffCommentPosted === true);
  const handoffCommentPosted =
    update.handoffCommentPosted === true ||
    update.checkpoints?.handoffCommentPosted === true ||
    existingHandoffCommentPosted;
  const failureCommentKeys = mergeUniqueKeys(
    update.resetCheckpoints ? undefined : existing?.failureCommentKeys,
    update.failureCommentKeys,
  );
  const blockerQuestions = blockerQuestionsUpdate(
    update.resetCheckpoints ? undefined : existing?.blockerQuestions,
    update.blockerQuestions,
    update.clearBlockerQuestions,
  );
  const blockerCommentKeys = mergeUniqueKeys(
    update.resetCheckpoints ? undefined : existing?.blockerCommentKeys,
    update.blockerCommentKeys,
  );

  if (handoffCommentPosted) {
    checkpoints = {
      ...(checkpoints ?? {}),
      handoffCommentPosted: true,
    };
  }

  const implementationPr =
    update.implementationPr ?? existingImplementation?.implementationPr;
  const merge = update.merge ?? existingImplementation?.merge;
  const next: AgentIssueRunState = {
    ...existing,
    issueNumber: update.issueNumber,
    title,
    status: update.status,
    branch:
      update.branch ?? (update.resetCheckpoints ? undefined : existing?.branch),
    worktreePath:
      update.worktreePath ??
      (update.resetCheckpoints ? undefined : existing?.worktreePath),
    todoRoot:
      update.todoRoot ??
      (update.resetCheckpoints ? undefined : existing?.todoRoot),
    specPath: update.specPath ?? existing?.specPath,
    specCommit: update.specCommit ?? existing?.specCommit,
    planPath: update.planPath ?? existing?.planPath,
    planCommit: update.planCommit ?? existing?.planCommit,
    checkpoints,
    implementationStatus,
    ...(implementationPr || existing?.implementationPr
      ? { implementationPr }
      : {}),
    ...(merge || existing?.merge ? { merge } : {}),
    prUrl,
    mergeCommit,
    commits,
    validation,
    reviewSummary,
    landingDecision,
    runCostReport,
    visualEvidence,
    handoffCommentPosted: handoffCommentPosted ? true : undefined,
    failureCommentKeys,
    blockerCommentKeys,
    leaseProtocolVersion:
      update.leaseProtocolVersion ?? existing?.leaseProtocolVersion ?? 1,
    blockerQuestions,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastError: update.clearLastError
      ? undefined
      : (update.lastError ?? existing?.lastError),
  };

  if (checkpoints === undefined) {
    delete next.checkpoints;
  }
  if (next.branch === undefined) {
    delete next.branch;
  }
  if (next.worktreePath === undefined) {
    delete next.worktreePath;
  }
  if (next.todoRoot === undefined) delete next.todoRoot;
  if (next.specPath === undefined) {
    delete next.specPath;
  }
  if (next.specCommit === undefined) {
    delete next.specCommit;
  }
  if (implementationStatus === undefined) {
    delete next.implementationStatus;
  }
  if (prUrl === undefined) {
    delete next.prUrl;
  }
  if (mergeCommit === undefined) {
    delete next.mergeCommit;
  }
  if (commits === undefined) {
    delete next.commits;
  }
  if (validation === undefined) {
    delete next.validation;
  }
  if (reviewSummary === undefined) {
    delete next.reviewSummary;
  }
  if (landingDecision === undefined) {
    delete next.landingDecision;
  }
  if (runCostReport === undefined) {
    delete next.runCostReport;
  }
  if (visualEvidence === undefined) {
    delete next.visualEvidence;
  }
  if (!handoffCommentPosted) {
    delete next.handoffCommentPosted;
  }
  if (failureCommentKeys === undefined) {
    delete next.failureCommentKeys;
  }
  if (blockerQuestions === undefined) {
    delete next.blockerQuestions;
  }
  if (blockerCommentKeys === undefined) delete next.blockerCommentKeys;
  if (next.leaseProtocolVersion === undefined) delete next.leaseProtocolVersion;
  if (next.lastError === undefined) {
    delete next.lastError;
  }

  const timestampField = STATUS_TIMESTAMPS[update.status];
  if (next[timestampField]) return next;
  return { ...next, [timestampField]: now };
}

export function isResumableRunState(state: AgentIssueRunState): boolean {
  return (
    state.status === "claimed" ||
    state.status === "planning" ||
    state.status === "implementing"
  );
}

export async function writeRunState(
  runStateDir: string,
  update: AgentIssueRunStateUpdate,
  lease: IssueRunLease,
  now = new Date().toISOString(),
): Promise<AgentIssueRunState> {
  await assertIssueRunLeaseOwned(lease, {
    runStateDir,
    issueNumber: update.issueNumber,
  });
  const existing = await readRunState(runStateDir, update.issueNumber);
  if (existing) validateRecoveryRunState(existing, update.issueNumber);
  const next = mergeRunState(existing, update, now);
  await atomicStateWrite(
    runStatePath(runStateDir, update.issueNumber),
    next,
    lease,
  );
  return next;
}

const RUN_STATUSES = new Set([
  "claimed",
  "planning",
  "implementing",
  "blocked",
  "finished",
]);
const RECOVERY_STRING_FIELDS = [
  "todoRoot",
  "branch",
  "worktreePath",
  "specPath",
  "specCommit",
  "planPath",
  "planCommit",
  "implementationStatus",
  "prUrl",
  "mergeCommit",
  "reviewSummary",
  "landingDecision",
  "createdAt",
  "updatedAt",
  "claimedAt",
  "planningAt",
  "implementingAt",
  "blockedAt",
  "finishedAt",
  "lastError",
] as const;
function isStringArray(value: unknown): boolean {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

/** Validate persisted recovery input before it can select archive or Git paths. */
export function validateRecoveryRunState(
  state: unknown,
  expectedIssueNumber: number,
): asserts state is AgentIssueRunState {
  if (!state || typeof state !== "object" || Array.isArray(state))
    throw new Error("Run recovery state is not an object");
  const value = state as Record<string, unknown>;
  if (
    value.issueNumber !== expectedIssueNumber ||
    !Number.isSafeInteger(value.issueNumber) ||
    value.issueNumber <= 0
  )
    throw new Error(
      `Run recovery state issue number does not match requested issue #${expectedIssueNumber}`,
    );
  if (
    typeof value.title !== "string" ||
    !RUN_STATUSES.has(value.status as string) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  )
    throw new Error("Run recovery state has an invalid required schema");
  for (const key of RECOVERY_STRING_FIELDS)
    if (value[key] !== undefined && typeof value[key] !== "string")
      throw new Error(`Run recovery state has invalid ${key}`);
  for (const key of [
    "commits",
    "validation",
    "failureCommentKeys",
    "blockerCommentKeys",
  ])
    if (value[key] !== undefined && !isStringArray(value[key]))
      throw new Error(`Run recovery state has invalid ${key}`);
  if (
    value.leaseProtocolVersion !== undefined &&
    value.leaseProtocolVersion !== 1
  )
    throw new Error("Run recovery state has an unsupported lease protocol");
  if (value.implementationPr !== undefined)
    assertImplementationPrEvidence(value.implementationPr);
  if (value.merge !== undefined) assertImplementationMergeEvidence(value.merge);
  if (value.checkpoints !== undefined) {
    if (!value.checkpoints || typeof value.checkpoints !== "object")
      throw new Error("Run recovery state has invalid checkpoints");
    if (Object.values(value.checkpoints).some((entry) => entry !== true))
      throw new Error("Run recovery state has invalid checkpoints");
  }
}

export async function readRunStateSnapshot(
  runStateDir: string,
  issueNumber: number,
): Promise<RunStateSnapshot | undefined> {
  const path = runStatePath(runStateDir, issueNumber);
  try {
    const raw = await readFile(path, "utf8");
    return { path, raw, state: JSON.parse(raw) as AgentIssueRunState };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicStateWrite(
  path: string,
  state: AgentIssueRunState,
  lease: IssueRunLease,
): Promise<void> {
  const runStateDir = dirname(path);
  await assertIssueRunLeaseOwned(lease, {
    runStateDir,
    issueNumber: state.issueNumber,
  });
  const temporary = `${path}.${lease.record.ownerToken}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertIssueRunLeaseOwned(lease, {
      runStateDir,
      issueNumber: state.issueNumber,
    });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function replaceRunStateAfterReset(
  runStateDir: string,
  input: { issueNumber: number; title: string; seed: RunResetSeed },
  lease: IssueRunLease,
  now = new Date().toISOString(),
): Promise<AgentIssueRunState> {
  await assertIssueRunLeaseOwned(lease, {
    runStateDir,
    issueNumber: input.issueNumber,
  });
  const state: AgentIssueRunState = {
    issueNumber: input.issueNumber,
    title: input.title,
    status: "claimed",
    ...(input.seed.specPath ? { specPath: input.seed.specPath } : {}),
    ...(input.seed.specCommit ? { specCommit: input.seed.specCommit } : {}),
    ...(input.seed.planPath ? { planPath: input.seed.planPath } : {}),
    ...(input.seed.planCommit ? { planCommit: input.seed.planCommit } : {}),
    checkpoints: {
      claimed: true,
      ...(input.seed.startedCommentPosted
        ? { startedCommentPosted: true }
        : {}),
    },
    leaseProtocolVersion: 1,
    createdAt: now,
    updatedAt: now,
    claimedAt: now,
  };
  await atomicStateWrite(
    runStatePath(runStateDir, input.issueNumber),
    state,
    lease,
  );
  return state;
}

export async function adoptRunStateLeaseProtocol(input: {
  snapshot: RunStateSnapshot;
  expectedStateSha256: string;
  lease: IssueRunLease;
  now?: string;
}): Promise<AgentIssueRunState> {
  await assertIssueRunLeaseOwned(input.lease, {
    runStateDir: dirname(input.snapshot.path),
    issueNumber: input.snapshot.state.issueNumber,
  });
  if (input.lease.record.issueNumber !== input.snapshot.state.issueNumber)
    throw new Error("Issue run lease does not match recovery state");
  if (
    !["claimed", "planning", "implementing"].includes(
      input.snapshot.state.status,
    )
  )
    throw new Error(
      "Only active legacy Run recovery state may adopt the lease protocol",
    );
  if (
    createHash("sha256").update(input.snapshot.raw).digest("hex") !==
    input.expectedStateSha256
  )
    throw new Error("Run recovery state fingerprint does not match");
  const current = await readFile(input.snapshot.path, "utf8");
  if (current !== input.snapshot.raw)
    throw new Error(
      "Run recovery state changed before lease protocol adoption",
    );
  const state: AgentIssueRunState = {
    ...input.snapshot.state,
    leaseProtocolVersion: 1,
    updatedAt: input.now ?? new Date().toISOString(),
  };
  await atomicStateWrite(input.snapshot.path, state, input.lease);
  return state;
}
