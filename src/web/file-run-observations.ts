import { resolve, join } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import type { Issue, PullRequest } from "../host/types.ts";
import { probeIssueLock, readLock } from "../kernel/lock.ts";
import type { RunState } from "../kernel/run-snapshot.ts";
import type { Phase } from "../kernel/phase.ts";
import type { WorkflowStage } from "../kernel/planning-workspace.ts";
import {
  WORKFLOW_STATUSES,
  type WorkflowStatus,
} from "../kernel/workflow-state.ts";
import type { StateStore } from "../state/store.ts";
import {
  readIssueRunRecords,
  type IssueRunRecord,
} from "./file-run-records.ts";
import { runFiles, timestamp } from "./run-files.ts";

export type RunObservation = {
  live: boolean;
  incomplete: boolean;
  state: RunState | null;
  phase: Phase | null;
  stage: WorkflowStage | null;
  branch: string | null;
  specPath: string | null;
  planPath: string | null;
  outcomeRole: WorkflowStatus | null;
  summary: string | null;
  interactive: boolean | null;
  pullRequest: PullRequest | null;
  records?: readonly IssueRunRecord[];
  startedAt?: string | null;
  finishedAt?: string | null;
  elapsedSeconds?: number | null;
  step?: string | null;
  historicalPullRequests?: readonly PullRequest[];
};
const empty = (): RunObservation => ({
  live: false,
  incomplete: false,
  state: null,
  phase: null,
  stage: null,
  branch: null,
  specPath: null,
  planPath: null,
  outcomeRole: null,
  summary: null,
  interactive: null,
  pullRequest: null,
});

export async function readIssueObservation(input: {
  repoRoot: string;
  config: PatchmillConfig;
  issue: number;
  warn: (message: string) => void;
}): Promise<RunObservation> {
  const root = resolve(input.repoRoot, input.config.paths.runsDir);
  const dir = join(root, `issue-${input.issue}`);
  const files = runFiles(root, input.warn);
  const records = await readIssueRunRecords(input);
  const latest = records.at(-1);
  let ownership: boolean | null = false;
  if (await files.directory(dir)) {
    try {
      ownership = await probeIssueLock(join(dir, "lock"));
    } catch {
      ownership = null;
      input.warn("Could not read optional issue ownership.");
    }
  }
  const live = ownership === true;
  const metadata = {
    records,
    startedAt: records[0]?.startedAt ?? null,
    finishedAt: latest?.finishedAt ?? null,
    elapsedSeconds:
      records.length && records.every((r) => r.finishedAt !== null)
        ? records.reduce(
            (sum, r) =>
              sum +
              (Date.parse(r.finishedAt!) - Date.parse(r.startedAt)) / 1000,
            0,
          )
        : null,
    historicalPullRequests: records.flatMap((r) =>
      r.progress?.facts?.pullRequest ? [r.progress.facts.pullRequest] : [],
    ),
  };
  if (live) {
    try {
      const lock = await readLock(join(dir, "lock"));
      if (
        !latest ||
        !lock ||
        !timestamp(lock.startedAt) ||
        Date.parse(lock.startedAt) > Date.parse(latest.startedAt)
      )
        return { ...empty(), ...metadata, live };
    } catch {
      input.warn("Could not read optional issue ownership.");
      return { ...empty(), ...metadata, live };
    }
  }
  if (!latest) return { ...empty(), ...metadata, live };
  const p = latest.progress;
  const phase = p?.phase ?? latest.sessions.at(-1)?.phase ?? null;
  const stage = p?.facts?.stage ?? null;
  return {
    ...metadata,
    live,
    state: latest.finishedAt !== null ? "ended" : (p?.state ?? null),
    incomplete: ownership === false && latest.finishedAt === null,
    phase,
    stage,
    step:
      phase === "implementation"
        ? "Implementation"
        : stage === "spec"
          ? "Spec"
          : stage === "plan"
            ? "Plan"
            : phase === "planning"
              ? "Planning"
              : null,
    branch: p?.facts?.branch ?? null,
    specPath: p?.facts?.specPath ?? null,
    planPath: p?.facts?.planPath ?? null,
    pullRequest: p?.facts?.pullRequest ?? null,
    interactive: p?.interactive ?? null,
    outcomeRole: latest.outcome?.label ?? null,
    summary: latest.outcome?.summary ?? p?.summary ?? null,
  };
}

export async function readWorkflowRoles(
  issue: Issue,
  input: { config: PatchmillConfig; store: StateStore },
): Promise<readonly WorkflowStatus[]> {
  if (input.config.workflow.stateTracking === "local") {
    const last = (await input.store.readStatus(issue.number)).at(-1);
    return last ? [last.status] : [];
  }
  return WORKFLOW_STATUSES.filter((role) =>
    issue.labels.includes(input.config.labels[role]),
  );
}
