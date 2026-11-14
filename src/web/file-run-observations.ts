import fs from "node:fs/promises";
import { resolve, join } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import type { Issue, PullRequest } from "../host/types.ts";
import { probeIssueLock, readLock } from "../kernel/lock.ts";
import { parseRunProgress } from "../kernel/run-progress.ts";
import type { RunState } from "../kernel/run-snapshot.ts";
import type { Phase } from "../kernel/phase.ts";
import type { WorkflowStage } from "../kernel/planning-workspace.ts";
import {
  WORKFLOW_STATUSES,
  type WorkflowStatus,
} from "../kernel/workflow-state.ts";
import type { StateStore } from "../state/store.ts";

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
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const time = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const runName = /^\d{8}-\d{6}-[a-f0-9]{4}$/;
type Result = {
  runId: string;
  startedAt: string;
  phase: Phase | null;
  outcomeRole: WorkflowStatus;
  summary: string | null;
};
function parseResult(
  v: unknown,
  issue: number,
  runId: string,
): Result | undefined {
  if (
    !object(v) ||
    v.issue !== issue ||
    v.runId !== runId ||
    !time(v.startedAt) ||
    !time(v.finishedAt) ||
    !Array.isArray(v.sessions) ||
    !object(v.outcome) ||
    v.outcome.issue !== issue
  )
    return;
  const o = v.outcome;
  if (
    o.status !== "completed" &&
    !(
      o.status === "stopped" &&
      ["done", "inProgress", "needsInfo"].includes(String(o.label))
    )
  )
    return;
  const last: unknown = v.sessions.at(-1);
  const phase =
    object(last) &&
    (last.phase === "planning" || last.phase === "implementation")
      ? last.phase
      : null;
  return {
    runId,
    startedAt: v.startedAt,
    phase,
    outcomeRole:
      o.status === "completed" ? "done" : (o.label as WorkflowStatus),
    summary: typeof o.summary === "string" ? o.summary : null,
  };
}

export async function readIssueObservation(input: {
  repoRoot: string;
  config: PatchmillConfig;
  issue: number;
  warn: (message: string) => void;
}): Promise<RunObservation> {
  const { issue, warn } = input;
  const dir = resolve(
    input.repoRoot,
    input.config.paths.runsDir,
    `issue-${issue}`,
  );
  const warning = () =>
    warn(`Could not read optional run data for issue #${issue}.`);
  const json = async (path: string): Promise<unknown> => {
    try {
      return JSON.parse(await fs.readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") warning();
      return undefined;
    }
  };
  let ownership: boolean | null = null;
  try {
    ownership = await probeIssueLock(join(dir, "lock"));
  } catch {
    warning();
  }
  const live = ownership === true;
  const raw = await json(join(dir, "progress.json"));
  const progress = parseRunProgress(raw, issue);
  if (raw !== undefined && !progress) warning();
  let results: Result[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const parsed = await Promise.all(
      entries
        .filter((e) => e.isDirectory() && runName.test(e.name))
        .map(async (e) => {
          const value = await json(join(dir, e.name, "result.json"));
          const result = parseResult(value, issue, e.name);
          if (value !== undefined && !result) warning();
          return result;
        }),
    );
    results = parsed
      .filter((v): v is Result => !!v)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") warning();
  }
  const latest = results[0];
  const useProgress =
    progress &&
    (!latest || Date.parse(progress.startedAt) >= Date.parse(latest.startedAt));
  const startedAt = useProgress ? progress.startedAt : latest?.startedAt;
  if (live) {
    let lock;
    try {
      lock = await readLock(join(dir, "lock"));
    } catch {
      warning();
    }
    if (
      !startedAt ||
      !lock ||
      !time(lock.startedAt) ||
      Date.parse(lock.startedAt) > Date.parse(startedAt)
    )
      return { ...empty(), live };
  }
  if (!useProgress)
    return latest
      ? {
          ...empty(),
          live,
          state: "ended",
          phase: latest.phase,
          outcomeRole: latest.outcomeRole,
          summary: latest.summary,
        }
      : { ...empty(), live };
  const result = latest?.runId === progress.runId ? latest : undefined;
  const state = result ? "ended" : progress.state;
  return {
    live,
    state,
    incomplete: ownership === false && state !== "ended",
    phase: progress.phase,
    stage: progress.facts?.stage ?? null,
    branch: progress.facts?.branch ?? null,
    specPath: progress.facts?.specPath ?? null,
    planPath: progress.facts?.planPath ?? null,
    pullRequest: progress.facts?.pullRequest ?? null,
    interactive: progress.interactive,
    outcomeRole: result?.outcomeRole ?? progress.outcome?.label ?? null,
    summary: progress.summary ?? result?.summary ?? null,
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
