import type {
  PlanningWorkspaceIdentity,
  PlanningWorkspaceOwnership,
} from "../git/planning-workspaces.ts";
import type {
  PullRequestReference,
  RepositoryIdentity,
} from "../host/pull-requests.ts";
import {
  PLANNING_PR_WORKFLOW_VERSION,
  type PlanningPhaseKind,
} from "./planning-pull-request-markers.ts";
import {
  planningPhasePlan,
  type PlanningArtifactKind,
  type PlanningGateSnapshot,
} from "./planning-pull-requests.ts";
import type {
  PlanningPhaseStateV1,
  PlanningStateV1,
} from "./planning-state-types.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FULL_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export class PlanningStateValidationError extends Error {
  readonly reason: string;
  readonly path: string;
  readonly statePath?: string;
  constructor(reason: string, path: string, statePath?: string) {
    super(`Planning state is invalid: ${reason} at ${path}`);
    this.name = "PlanningStateValidationError";
    this.reason = reason;
    this.path = path;
    if (statePath !== undefined) this.statePath = statePath;
  }
}
const fail = (reason: string, path: string): never => {
  throw new PlanningStateValidationError(reason, path);
};
const object = (
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("expected-object", path);
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result))
    if (!keys.includes(key)) fail("unknown-key", `${path}.${key}`);
  for (const key of keys)
    if (!(key in result)) fail("missing-key", `${path}.${key}`);
  return result;
};
const string = (
  value: unknown,
  path: string,
  reason = "invalid-string",
): string => (typeof value === "string" ? value : fail(reason, path));
const positive = (value: unknown, path: string): number =>
  Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : fail("invalid-positive-integer", path);
const nonnegative = (value: unknown, path: string): number =>
  Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : fail("invalid-nonnegative-integer", path);
const uuid = (value: unknown, path: string): string => {
  const v = string(value, path);
  return UUID.test(v) ? v : fail("invalid-uuid", path);
};
const oid = (value: unknown, path: string): string => {
  const v = string(value, path);
  return FULL_OID.test(v) ? v : fail("invalid-oid", path);
};
const timestamp = (value: unknown, path: string): string => {
  const v = string(value, path);
  return ISO_TIMESTAMP.test(v) &&
    !Number.isNaN(Date.parse(v)) &&
    new Date(v).toISOString() === v
    ? v
    : fail("invalid-timestamp", path);
};
const singleLine = (value: unknown, path: string): string => {
  const v = string(value, path);
  return v.length > 0 && v.length <= 1024 && !/[\0\r\n]/u.test(v)
    ? v
    : fail("invalid-string", path);
};
const branch = (value: unknown, path: string): string => {
  const v = singleLine(value, path);
  return v.length <= 1024 &&
    !v.startsWith("-") &&
    !v.startsWith("/") &&
    !v.endsWith("/") &&
    !v.endsWith(".") &&
    !/[\s\\~^:?*[\x00-\x1f]|\.\.|@\{/u.test(v) &&
    !v.split("/").some((part) => part.length === 0)
    ? v
    : fail("invalid-branch", path);
};
const artifactPath = (value: unknown, path: string): string => {
  const v = string(value, path);
  return v.length > 0 &&
    v.length <= 4096 &&
    !/[\0\r\n\\]/u.test(v) &&
    !v.startsWith("/") &&
    !v.split("/").some((part) => part === "" || part === "." || part === "..")
    ? v
    : fail("invalid-path", path);
};
const worktreePath = (value: unknown, path: string): string => {
  const v = string(value, path);
  return v.length > 0 && v.length <= 4096 && !/[\0\r\n]/u.test(v)
    ? v
    : fail("invalid-worktree-path", path);
};

function gates(value: unknown, path: string): PlanningGateSnapshot {
  const v = object(value, ["specRequired", "planRequired"], path);
  if (
    typeof v.specRequired !== "boolean" ||
    typeof v.planRequired !== "boolean"
  )
    fail("invalid-gates", path);
  return {
    specRequired: v.specRequired as boolean,
    planRequired: v.planRequired as boolean,
  };
}
function candidates(
  value: unknown,
  path: string,
): { spec: readonly string[]; plan: readonly string[] } {
  const v = object(value, ["spec", "plan"], path);
  return {
    spec: paths(v.spec, `${path}.spec`),
    plan: paths(v.plan, `${path}.plan`),
  };
}
function paths(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) fail("expected-array", path);
  const output = (value as unknown[]).map((item, index) =>
    artifactPath(item, `${path}[${index}]`),
  );
  if (new Set(output).size !== output.length) fail("duplicate-value", path);
  return output;
}
function identity(value: unknown, path: string): PlanningWorkspaceIdentity {
  const v = object(value, ["branch", "worktreePath"], path);
  return {
    branch: branch(v.branch, `${path}.branch`),
    worktreePath: worktreePath(v.worktreePath, `${path}.worktreePath`),
  };
}
function repository(value: unknown, path: string): RepositoryIdentity {
  const v = object(value, ["provider", "host", "owner", "repository"], path);
  const provider = string(v.provider, `${path}.provider`);
  if (provider !== "github-gh" && provider !== "forgejo-tea")
    fail("invalid-provider", `${path}.provider`);
  return {
    provider,
    host: singleLine(v.host, `${path}.host`),
    owner: singleLine(v.owner, `${path}.owner`),
    repository: singleLine(v.repository, `${path}.repository`),
  } as RepositoryIdentity;
}
function workspace(value: unknown, path: string) {
  const v = object(
    value,
    [
      "runId",
      "phase",
      "identity",
      "remote",
      "baseBranch",
      "baseOid",
      "headOid",
      "cleanup",
    ],
    path,
  );
  const cleanupValue = v.cleanup as Record<string, unknown>;
  const cleanup = object(
    cleanupValue,
    cleanupValue?.state === "ready" ? ["state"] : ["state", "pushedHeadOid"],
    `${path}.cleanup`,
  );
  const state = string(cleanup.state, `${path}.cleanup.state`);
  if (state !== "ready" && state !== "worktree-removed" && state !== "removed")
    fail("invalid-cleanup", `${path}.cleanup.state`);
  return {
    runId: uuid(v.runId, `${path}.runId`),
    phase: phase(v.phase, `${path}.phase`),
    identity: identity(v.identity, `${path}.identity`),
    remote: singleLine(v.remote, `${path}.remote`),
    baseBranch: branch(v.baseBranch, `${path}.baseBranch`),
    baseOid: oid(v.baseOid, `${path}.baseOid`),
    headOid: oid(v.headOid, `${path}.headOid`),
    cleanup:
      state === "ready"
        ? { state }
        : {
            state,
            pushedHeadOid: oid(
              cleanup.pushedHeadOid,
              `${path}.cleanup.pushedHeadOid`,
            ),
          },
  } as PlanningWorkspaceOwnership;
}
function base(value: unknown, path: string) {
  const v = object(
    value,
    ["remote", "baseBranch", "baseOid", "artifactCandidates"],
    path,
  );
  return {
    remote: singleLine(v.remote, `${path}.remote`),
    baseBranch: branch(v.baseBranch, `${path}.baseBranch`),
    baseOid: oid(v.baseOid, `${path}.baseOid`),
    artifactCandidates: candidates(
      v.artifactCandidates,
      `${path}.artifactCandidates`,
    ),
  };
}
function phase(value: unknown, path: string): PlanningPhaseKind {
  const v = string(value, path);
  return v === "spec" || v === "plan" || v === "implementation"
    ? v
    : fail("invalid-phase", path);
}
function artifacts(value: unknown, path: string) {
  if (!Array.isArray(value)) fail("expected-array", path);
  const output = (value as unknown[]).map((item, i) => {
    const v = object(
      item,
      ["kind", "path", "commitOid", "source"],
      `${path}[${i}]`,
    );
    const kind = string(v.kind, `${path}[${i}].kind`);
    if (kind !== "spec" && kind !== "plan")
      fail("invalid-artifact-kind", `${path}[${i}].kind`);
    const source = string(v.source, `${path}[${i}].source`);
    if (source !== "remote-base" && source !== "workspace")
      fail("invalid-artifact-source", `${path}[${i}].source`);
    return {
      kind: kind as PlanningArtifactKind,
      path: artifactPath(v.path, `${path}[${i}].path`),
      commitOid: oid(v.commitOid, `${path}[${i}].commitOid`),
      source: source as "remote-base" | "workspace",
    };
  });
  if (new Set(output.map((item) => item.kind)).size !== output.length)
    fail("duplicate-artifact-kind", path);
  return output;
}
function pullRequest(value: unknown, path: string) {
  const v = object(
    value,
    ["reference", "baseBranch", "headBranch", "headOid"],
    path,
  );
  const ref = object(
    v.reference,
    ["targetRepository", "number"],
    `${path}.reference`,
  );
  return {
    reference: {
      targetRepository: repository(
        ref.targetRepository,
        `${path}.reference.targetRepository`,
      ),
      number: positive(ref.number, `${path}.reference.number`),
    } as PullRequestReference,
    baseBranch: branch(v.baseBranch, `${path}.baseBranch`),
    headBranch: branch(v.headBranch, `${path}.headBranch`),
    headOid: oid(v.headOid, `${path}.headOid`),
  };
}

function phaseState(value: unknown, path: string): PlanningPhaseStateV1 {
  const raw = value as Record<string, unknown>;
  const status = raw?.status;
  const completion = raw?.completion as Record<string, unknown> | undefined;
  const keys =
    status === "pending"
      ? ["kind", "status"]
      : status === "workspace-ready"
        ? ["kind", "status", "base", "workspace"]
        : status === "pull-request-open"
          ? ["kind", "status", "base", "workspace", "artifacts", "pullRequest"]
          : completion?.kind === "remote-base"
            ? ["kind", "status", "base", "artifacts", "completion"]
            : [
                "kind",
                "status",
                "base",
                "workspace",
                "artifacts",
                "pullRequest",
                "completion",
              ];
  const v = object(value, keys, path);
  const kind = phase(v.kind, `${path}.kind`);
  if (v.status === "pending") return { kind, status: "pending" };
  if (v.status === "workspace-ready")
    return {
      kind,
      status: "workspace-ready",
      base: base(v.base, `${path}.base`),
      workspace: workspace(v.workspace, `${path}.workspace`),
    };
  if (v.status === "pull-request-open")
    return {
      kind,
      status: "pull-request-open",
      base: base(v.base, `${path}.base`),
      workspace: workspace(v.workspace, `${path}.workspace`),
      artifacts: artifacts(v.artifacts, `${path}.artifacts`),
      pullRequest: pullRequest(v.pullRequest, `${path}.pullRequest`),
    };
  if (v.status !== "complete") fail("invalid-status", `${path}.status`);
  const c = v.completion as Record<string, unknown>;
  if (c?.kind === "remote-base") {
    object(c, ["kind"], `${path}.completion`);
    return {
      kind,
      status: "complete",
      base: base(v.base, `${path}.base`),
      artifacts: artifacts(v.artifacts, `${path}.artifacts`),
      completion: { kind: "remote-base" },
    };
  }
  const merged = object(c, ["kind", "mergeOid"], `${path}.completion`);
  if (merged.kind !== "merged-pull-request")
    fail("invalid-completion", `${path}.completion.kind`);
  return {
    kind,
    status: "complete",
    base: base(v.base, `${path}.base`),
    workspace: workspace(v.workspace, `${path}.workspace`),
    artifacts: artifacts(v.artifacts, `${path}.artifacts`),
    pullRequest: pullRequest(v.pullRequest, `${path}.pullRequest`),
    completion: {
      kind: "merged-pull-request",
      mergeOid: oid(merged.mergeOid, `${path}.completion.mergeOid`),
    },
  };
}

export function validatePlanningState(value: unknown): PlanningStateV1 {
  const v = object(
    value,
    [
      "version",
      "workflowVersion",
      "runId",
      "issueNumber",
      "issueTitle",
      "gates",
      "phases",
      "revision",
      "createdAt",
      "updatedAt",
    ],
    "$",
  );
  if (v.version !== 1) fail("unsupported-version", "$.version");
  if (v.workflowVersion !== PLANNING_PR_WORKFLOW_VERSION)
    fail("unsupported-workflow-version", "$.workflowVersion");
  const parsedGates = gates(v.gates, "$.gates");
  if (!Array.isArray(v.phases)) fail("expected-array", "$.phases");
  const phases = (v.phases as unknown[]).map((item, i) =>
    phaseState(item, `$.phases[${i}]`),
  );
  const expected = planningPhasePlan(parsedGates);
  if (
    phases.length !== expected.length ||
    phases.some((item, i) => item.kind !== expected[i]?.kind)
  )
    fail("phase-sequence", "$.phases");
  const statuses = phases.map((item) => item.status);
  const active = statuses.filter(
    (status) => status === "workspace-ready" || status === "pull-request-open",
  );
  if (active.length > 1) fail("multiple-active-phases", "$.phases");
  let pending = false;
  let completed = false;
  for (let i = 0; i < phases.length; i += 1) {
    const p = phases[i]!;
    if (p.status === "pending") pending = true;
    else {
      if (pending) fail("progress-order", `$.phases[${i}]`);
      if (p.status === "complete") completed = true;
      else if (completed) fail("progress-order", `$.phases[${i}]`);
    }
    const assigned = expected[i]!.artifactKinds;
    if (
      p.status !== "pending" &&
      "artifacts" in p &&
      (p.artifacts.length !== assigned.length ||
        p.artifacts.some((a, j) => a.kind !== assigned[j]))
    )
      fail("artifact-kinds", `$.phases[${i}].artifacts`);
    if ("workspace" in p) {
      if (
        p.workspace.runId !== v.runId ||
        p.workspace.phase !== p.kind ||
        p.workspace.remote !== p.base.remote ||
        p.workspace.baseBranch !== p.base.baseBranch ||
        p.workspace.baseOid !== p.base.baseOid
      )
        fail("workspace-mismatch", `$.phases[${i}].workspace`);
      if (
        (p.status === "workspace-ready" || p.status === "pull-request-open") &&
        p.workspace.cleanup.state !== "ready"
      )
        fail("invalid-cleanup-progress", `$.phases[${i}].workspace.cleanup`);
    }
  }
  const createdAt = timestamp(v.createdAt, "$.createdAt"),
    updatedAt = timestamp(v.updatedAt, "$.updatedAt");
  if (updatedAt < createdAt) fail("timestamp-order", "$.updatedAt");
  return {
    version: 1,
    workflowVersion: PLANNING_PR_WORKFLOW_VERSION,
    runId: uuid(v.runId, "$.runId"),
    issueNumber: positive(v.issueNumber, "$.issueNumber"),
    issueTitle: singleLine(v.issueTitle, "$.issueTitle"),
    gates: parsedGates,
    phases,
    revision: nonnegative(v.revision, "$.revision"),
    createdAt,
    updatedAt,
  };
}
