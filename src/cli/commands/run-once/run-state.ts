import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentIssueRunState,
  AgentIssueRunStateStatus,
  AgentIssueRunStateUpdate,
} from "./types.ts";

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
  try {
    const content = await readFile(
      runStatePath(runStateDir, issueNumber),
      "utf8",
    );
    return JSON.parse(content) as AgentIssueRunState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
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
    "visualEvidence",
  ].some((key) => Object.hasOwn(update, key));
  const implementationStatus = hasImplementationUpdate
    ? update.implementationStatus
    : existingImplementation?.implementationStatus;
  const prUrl =
    update.implementationStatus === "merged"
      ? undefined
      : hasImplementationUpdate
        ? update.prUrl
        : existingImplementation?.prUrl;
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

  if (handoffCommentPosted) {
    checkpoints = {
      ...(checkpoints ?? {}),
      handoffCommentPosted: true,
    };
  }

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
    specPath: update.specPath ?? existing?.specPath,
    specCommit: update.specCommit ?? existing?.specCommit,
    planPath: update.planPath ?? existing?.planPath,
    planCommit: update.planCommit ?? existing?.planCommit,
    checkpoints,
    implementationStatus,
    prUrl,
    mergeCommit,
    commits,
    validation,
    reviewSummary,
    landingDecision,
    visualEvidence,
    handoffCommentPosted: handoffCommentPosted ? true : undefined,
    failureCommentKeys,
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
  if (visualEvidence === undefined) {
    delete next.visualEvidence;
  }
  if (!handoffCommentPosted) {
    delete next.handoffCommentPosted;
  }
  if (failureCommentKeys === undefined) {
    delete next.failureCommentKeys;
  }
  if (next.lastError === undefined) {
    delete next.lastError;
  }

  const timestampField = STATUS_TIMESTAMPS[update.status];
  if (!next[timestampField]) {
    next[timestampField] = now;
  }

  return next;
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
  now = new Date().toISOString(),
): Promise<AgentIssueRunState> {
  await mkdir(runStateDir, { recursive: true });
  const path = runStatePath(runStateDir, update.issueNumber);
  const existing = await readRunState(runStateDir, update.issueNumber);
  const next = mergeRunState(existing, update, now);
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
