import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Facts } from "./facts.ts";
import type { PullRequest } from "../host/types.ts";
import type {
  RunSnapshot,
  RunState,
  ObservedRunOutcome,
} from "./run-snapshot.ts";

export type RunProgress = {
  schemaVersion: 1;
  issue: number;
  runId: string;
  startedAt: string;
  updatedAt: string;
  state: RunState;
  phase: NonNullable<RunSnapshot["phase"]> | null;
  session: number;
  interactive: boolean;
  facts: {
    stage: Facts["stage"];
    branch: string;
    baseBranch: string;
    specPath: string | null;
    planPath: string | null;
    pullRequest: PullRequest | null;
  } | null;
  summary: string | null;
  outcome: ObservedRunOutcome | null;
};
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const timestamp = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT.*Z$/.test(v) &&
  Number.isFinite(Date.parse(v));
const artifactPath = (v: unknown) =>
  v === null ||
  (typeof v === "string" &&
    v.length > 0 &&
    !/^[\\/]|^[a-z]:|[\\\0]/i.test(v) &&
    !v.split("/").some((p) => p === ".." || p === "." || p === ""));
function pullRequest(v: unknown): boolean {
  if (v === null) return true;
  if (!object(v)) return false;
  return (
    Number.isSafeInteger(v.number) &&
    Number(v.number) > 0 &&
    ["url", "body", "headBranch", "baseBranch"].every(
      (k) => typeof v[k] === "string",
    ) &&
    (v.headRepository === null || typeof v.headRepository === "string") &&
    typeof v.draft === "boolean" &&
    ["open", "merged", "closed"].includes(String(v.state))
  );
}

/** Reject damaged observations; disk records never drive kernel decisions. */
export function parseRunProgress(
  value: unknown,
  issue: number,
): RunProgress | undefined {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.issue !== issue ||
    !Number.isSafeInteger(issue) ||
    issue < 1 ||
    typeof value.runId !== "string" ||
    !/^\d{8}-\d{6}-[a-f0-9]{4}$/.test(value.runId) ||
    !timestamp(value.startedAt) ||
    !timestamp(value.updatedAt) ||
    ![
      "deriving",
      "planning",
      "implementation",
      "gate-wait",
      "review-wait",
      "blocked",
      "ended",
    ].includes(String(value.state)) ||
    ![null, "planning", "implementation"].includes(value.phase as null) ||
    !Number.isSafeInteger(value.session) ||
    Number(value.session) < 0 ||
    typeof value.interactive !== "boolean" ||
    !(value.summary === null || typeof value.summary === "string")
  )
    return undefined;
  const f = value.facts;
  if (
    f !== null &&
    (!object(f) ||
      !["spec", "plan", "implementation"].includes(String(f.stage)) ||
      typeof f.branch !== "string" ||
      typeof f.baseBranch !== "string" ||
      !artifactPath(f.specPath) ||
      !artifactPath(f.planPath) ||
      !pullRequest(f.pullRequest))
  )
    return undefined;
  const o = value.outcome;
  if (
    o !== null &&
    (!object(o) ||
      !["completed", "stopped"].includes(String(o.status)) ||
      !["done", "inProgress", "needsInfo"].includes(String(o.label)))
  )
    return undefined;
  if (value.state === "ended" && o === null) return undefined;
  return {
    schemaVersion: 1,
    issue,
    runId: value.runId,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    state: value.state as RunState,
    phase: value.phase as RunProgress["phase"],
    session: Number(value.session),
    interactive: value.interactive,
    facts:
      f === null
        ? null
        : ({
            stage: f.stage,
            branch: f.branch,
            baseBranch: f.baseBranch,
            specPath: f.specPath,
            planPath: f.planPath,
            pullRequest: f.pullRequest,
          } as RunProgress["facts"]),
    summary: value.summary,
    outcome: o as RunProgress["outcome"],
  };
}

export function projectRunProgress(
  snapshot: RunSnapshot,
  interactive: boolean,
  now: Date,
): RunProgress {
  const f = snapshot.facts;
  return {
    schemaVersion: 1,
    issue: snapshot.issue,
    runId: snapshot.runId,
    startedAt: snapshot.startedAt,
    updatedAt: now.toISOString(),
    state: snapshot.state,
    phase: snapshot.phase ?? null,
    session: snapshot.session,
    interactive,
    facts: f
      ? {
          stage: f.stage,
          branch: f.branch,
          baseBranch: f.baseBranch,
          specPath: f.specPath ?? null,
          planPath: f.planPath ?? null,
          pullRequest: f.pullRequest ? { ...f.pullRequest, body: "" } : null,
        }
      : null,
    summary: snapshot.summary ?? null,
    outcome: snapshot.outcome ?? null,
  };
}

export async function writeRunProgress(
  issueDir: string,
  record: RunProgress,
): Promise<void> {
  await fs.mkdir(issueDir, { recursive: true });
  const temporary = join(issueDir, `.progress-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(record));
    await fs.rename(temporary, join(issueDir, "progress.json"));
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
