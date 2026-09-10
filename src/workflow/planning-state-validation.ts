import {
  isPlanningArtifactPath,
  isPlanningBranch,
  isPlanningSingleLine,
  planningOid,
} from "../git/planning-git-validation.ts";
import type {
  PlanningWorkspaceIdentity,
  PlanningWorkspaceOwnership,
} from "../git/planning-workspaces.ts";
import {
  sameRepositoryIdentity,
  type PullRequestReference,
  type RepositoryIdentity,
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
  PlanningArtifactEvidence,
  PlanningImplementationFinishCheckpoints,
  PlanningPhaseStateV1,
  PlanningStateV1,
} from "./planning-state-types.ts";
import {
  assertPlanningPublicationRepositories,
  PlanningPublicationRepositoryError,
} from "./planning-publication-repositories.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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
): Record<string, unknown> => objectWithOptionalKeys(value, keys, [], path);
const objectWithOptionalKeys = (
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  path: string,
): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("expected-object", path);
  const result = value as Record<string, unknown>;
  const allowedKeys = [...requiredKeys, ...optionalKeys];
  for (const key of Object.keys(result))
    if (!allowedKeys.includes(key)) fail("unknown-key", `${path}.${key}`);
  for (const key of requiredKeys)
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
const oid = (value: unknown, path: string): string => {
  const parsed = string(value, path);
  return planningOid.test(parsed) ? parsed : fail("invalid-oid", path);
};
const singleLine = (value: unknown, path: string): string => {
  const parsed = string(value, path);
  return isPlanningSingleLine(parsed) ? parsed : fail("invalid-string", path);
};
const nonblankSingleLine = (value: unknown, path: string): string => {
  const parsed = singleLine(value, path);
  return parsed.trim().length > 0 ? parsed : fail("invalid-string", path);
};
const branch = (value: unknown, path: string): string => {
  const parsed = string(value, path);
  return isPlanningBranch(parsed) ? parsed : fail("invalid-branch", path);
};
const artifactPath = (value: unknown, path: string): string => {
  const parsed = string(value, path);
  return isPlanningArtifactPath(parsed) ? parsed : fail("invalid-path", path);
};
function timestamp(value: unknown, path: string): string {
  const parsed = string(value, path);
  return ISO_TIMESTAMP.test(parsed) &&
    !Number.isNaN(Date.parse(parsed)) &&
    new Date(parsed).toISOString() === parsed
    ? parsed
    : fail("invalid-timestamp", path);
}
function phase(value: unknown, path: string): PlanningPhaseKind {
  const parsed = string(value, path);
  return parsed === "spec" || parsed === "plan" || parsed === "implementation"
    ? parsed
    : fail("invalid-phase", path);
}
function repository(value: unknown, path: string): RepositoryIdentity {
  const parsed = object(
    value,
    ["provider", "host", "owner", "repository"],
    path,
  );
  const provider = string(parsed.provider, `${path}.provider`);
  if (provider !== "github-gh" && provider !== "forgejo-tea")
    fail("invalid-provider", `${path}.provider`);
  return {
    provider,
    host: singleLine(parsed.host, `${path}.host`),
    owner: singleLine(parsed.owner, `${path}.owner`),
    repository: singleLine(parsed.repository, `${path}.repository`),
  } as RepositoryIdentity;
}
function candidates(
  value: unknown,
  path: string,
): { spec: readonly string[]; plan: readonly string[] } {
  const parsed = object(value, ["spec", "plan"], path);
  const parse = (items: unknown, child: string) => {
    if (!Array.isArray(items)) fail("expected-array", child);
    const paths = (items as unknown[]).map((item: unknown, index: number) =>
      artifactPath(item, `${child}[${index}]`),
    );
    if (new Set(paths).size !== paths.length) fail("duplicate-value", child);
    return paths;
  };
  return {
    spec: parse(parsed.spec, `${path}.spec`),
    plan: parse(parsed.plan, `${path}.plan`),
  };
}
function base(value: unknown, path: string) {
  const parsed = object(
    value,
    ["remote", "baseBranch", "baseOid", "artifactCandidates"],
    path,
  );
  return {
    remote: singleLine(parsed.remote, `${path}.remote`),
    baseBranch: branch(parsed.baseBranch, `${path}.baseBranch`),
    baseOid: oid(parsed.baseOid, `${path}.baseOid`),
    artifactCandidates: candidates(
      parsed.artifactCandidates,
      `${path}.artifactCandidates`,
    ),
  };
}
function workspace(value: unknown, path: string): PlanningWorkspaceOwnership {
  const parsed = object(
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
  const identity = object(
    parsed.identity,
    ["branch", "worktreePath"],
    `${path}.identity`,
  );
  const worktreePath = string(
    identity.worktreePath,
    `${path}.identity.worktreePath`,
  );
  if (
    worktreePath.length === 0 ||
    worktreePath.length > 4096 ||
    /[\0\r\n]/u.test(worktreePath)
  )
    fail("invalid-worktree-path", `${path}.identity.worktreePath`);
  const cleanupRaw = parsed.cleanup as Record<string, unknown>;
  const cleanup = object(
    cleanupRaw,
    cleanupRaw?.state === "ready" ? ["state"] : ["state", "pushedHeadOid"],
    `${path}.cleanup`,
  );
  const cleanupState = string(cleanup.state, `${path}.cleanup.state`);
  if (
    cleanupState !== "ready" &&
    cleanupState !== "worktree-removed" &&
    cleanupState !== "removed"
  )
    fail("invalid-cleanup", `${path}.cleanup.state`);
  const runId = string(parsed.runId, `${path}.runId`);
  if (!UUID.test(runId)) fail("invalid-uuid", `${path}.runId`);
  return {
    runId,
    phase: phase(parsed.phase, `${path}.phase`),
    identity: {
      branch: branch(identity.branch, `${path}.identity.branch`),
      worktreePath,
    } as PlanningWorkspaceIdentity,
    remote: singleLine(parsed.remote, `${path}.remote`),
    baseBranch: branch(parsed.baseBranch, `${path}.baseBranch`),
    baseOid: oid(parsed.baseOid, `${path}.baseOid`),
    headOid: oid(parsed.headOid, `${path}.headOid`),
    cleanup:
      cleanupState === "ready"
        ? { state: "ready" }
        : {
            state: cleanupState,
            pushedHeadOid: oid(
              cleanup.pushedHeadOid,
              `${path}.cleanup.pushedHeadOid`,
            ),
          },
  } as PlanningWorkspaceOwnership;
}
function artifacts(
  value: unknown,
  path: string,
): readonly PlanningArtifactEvidence[] {
  if (!Array.isArray(value)) fail("expected-array", path);
  const parsed = (value as unknown[]).map((item: unknown, index: number) => {
    const record = object(
      item,
      ["kind", "path", "commitOid", "source"],
      `${path}[${index}]`,
    );
    const kind = string(record.kind, `${path}[${index}].kind`);
    if (kind !== "spec" && kind !== "plan")
      fail("invalid-artifact-kind", `${path}[${index}].kind`);
    const source = string(record.source, `${path}[${index}].source`);
    if (source !== "remote-base" && source !== "workspace")
      fail("invalid-artifact-source", `${path}[${index}].source`);
    return {
      kind: kind as PlanningArtifactKind,
      path: artifactPath(record.path, `${path}[${index}].path`),
      commitOid: oid(record.commitOid, `${path}[${index}].commitOid`),
      source: source as "remote-base" | "workspace",
    };
  });
  if (
    new Set(parsed.map((artifact: PlanningArtifactEvidence) => artifact.kind))
      .size !== parsed.length
  )
    fail("duplicate-artifact-kind", path);
  return parsed;
}
function publication(value: unknown, path: string) {
  const parsed = object(
    value,
    [
      "targetRepository",
      "headRepository",
      "baseBranch",
      "headBranch",
      "headOid",
    ],
    path,
  );
  const targetRepository = repository(
    parsed.targetRepository,
    `${path}.targetRepository`,
  );
  const headRepository = repository(
    parsed.headRepository,
    `${path}.headRepository`,
  );
  try {
    assertPlanningPublicationRepositories({ targetRepository, headRepository });
  } catch (error) {
    if (error instanceof PlanningPublicationRepositoryError)
      fail("publication-repository-mismatch", path);
    throw error;
  }
  return {
    targetRepository,
    headRepository,
    baseBranch: branch(parsed.baseBranch, `${path}.baseBranch`),
    headBranch: branch(parsed.headBranch, `${path}.headBranch`),
    headOid: oid(parsed.headOid, `${path}.headOid`),
  };
}
function safeUrl(value: unknown, path: string): string {
  const url = string(value, path);
  try {
    const parsedUrl = new URL(url);
    if (
      (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
      parsedUrl.username ||
      parsedUrl.password ||
      parsedUrl.search ||
      parsedUrl.hash ||
      /[\r\n]/u.test(url)
    )
      fail("invalid-url", path);
  } catch (error) {
    if (error instanceof PlanningStateValidationError) throw error;
    fail("invalid-url", path);
  }
  return url;
}
function pullRequest(value: unknown, path: string) {
  const parsed = object(value, ["reference", "url"], path);
  const reference = object(
    parsed.reference,
    ["targetRepository", "number"],
    `${path}.reference`,
  );
  const url = safeUrl(parsed.url, `${path}.url`);
  return {
    reference: {
      targetRepository: repository(
        reference.targetRepository,
        `${path}.reference.targetRepository`,
      ),
      number: positive(reference.number, `${path}.reference.number`),
    } as PullRequestReference,
    url,
  };
}
function nonnegativeFinite(value: unknown, path: string): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fail("invalid-nonnegative-number", path);
}
function implementationRunCost(value: unknown, path: string) {
  const parsed = object(
    value,
    ["stages", "promptTokens", "outputTokens", "estimatedCostUsd"],
    path,
  );
  if (!Array.isArray(parsed.stages)) fail("expected-array", `${path}.stages`);
  const model = (entry: unknown, entryPath: string) => {
    const parsedModel = object(
      entry,
      ["model", "promptTokens", "outputTokens", "estimatedCostUsd"],
      entryPath,
    );
    return {
      model: singleLine(parsedModel.model, `${entryPath}.model`),
      promptTokens: nonnegativeFinite(
        parsedModel.promptTokens,
        `${entryPath}.promptTokens`,
      ),
      outputTokens: nonnegativeFinite(
        parsedModel.outputTokens,
        `${entryPath}.outputTokens`,
      ),
      estimatedCostUsd: nonnegativeFinite(
        parsedModel.estimatedCostUsd,
        `${entryPath}.estimatedCostUsd`,
      ),
    };
  };
  return {
    stages: (parsed.stages as unknown[]).map((entry, index) => {
      const entryPath = `${path}.stages[${index}]`;
      const stage = object(
        entry,
        ["stage", "models", "promptTokens", "outputTokens", "estimatedCostUsd"],
        entryPath,
      );
      const models = stage.models;
      if (!Array.isArray(models)) fail("expected-array", `${entryPath}.models`);
      const modelEntries = models as unknown[];
      return {
        stage: singleLine(stage.stage, `${entryPath}.stage`),
        models: modelEntries.map((modelEntry, modelIndex) =>
          model(modelEntry, `${entryPath}.models[${modelIndex}]`),
        ),
        promptTokens: nonnegativeFinite(
          stage.promptTokens,
          `${entryPath}.promptTokens`,
        ),
        outputTokens: nonnegativeFinite(
          stage.outputTokens,
          `${entryPath}.outputTokens`,
        ),
        estimatedCostUsd: nonnegativeFinite(
          stage.estimatedCostUsd,
          `${entryPath}.estimatedCostUsd`,
        ),
      };
    }),
    promptTokens: nonnegativeFinite(
      parsed.promptTokens,
      `${path}.promptTokens`,
    ),
    outputTokens: nonnegativeFinite(
      parsed.outputTokens,
      `${path}.outputTokens`,
    ),
    estimatedCostUsd: nonnegativeFinite(
      parsed.estimatedCostUsd,
      `${path}.estimatedCostUsd`,
    ),
  };
}
function implementationEvidence(value: unknown, path: string) {
  const parsed = objectWithOptionalKeys(
    value,
    ["status", "prUrl", "branch", "commits", "validation", "visualEvidence"],
    ["reviewSummary", "landingDecision", "runCostReport"],
    path,
  );
  if (parsed.status !== "pr-created")
    fail("invalid-implementation-status", `${path}.status`);
  const entries = (items: unknown, itemPath: string) => {
    if (!Array.isArray(items) || items.length === 0)
      fail("expected-nonempty-array", itemPath);
    return (items as unknown[]).map((entry: unknown, index: number) =>
      nonblankSingleLine(entry, `${itemPath}[${index}]`),
    );
  };
  if (!Array.isArray(parsed.visualEvidence))
    fail("expected-array", `${path}.visualEvidence`);
  return {
    status: "pr-created" as const,
    prUrl: safeUrl(parsed.prUrl, `${path}.prUrl`),
    branch: branch(parsed.branch, `${path}.branch`),
    commits: entries(parsed.commits, `${path}.commits`).map(
      (entry: string, index: number) => oid(entry, `${path}.commits[${index}]`),
    ),
    validation: entries(parsed.validation, `${path}.validation`),
    ...(parsed.reviewSummary === undefined
      ? {}
      : {
          reviewSummary: singleLine(
            parsed.reviewSummary,
            `${path}.reviewSummary`,
          ),
        }),
    ...(parsed.landingDecision === undefined
      ? {}
      : {
          landingDecision: singleLine(
            parsed.landingDecision,
            `${path}.landingDecision`,
          ),
        }),
    visualEvidence: (parsed.visualEvidence as unknown[]).map(
      (entry: unknown, index: number) => {
        const visualPath = `${path}.visualEvidence[${index}]`;
        const visual = objectWithOptionalKeys(
          entry,
          ["screenshotPath"],
          ["caption", "referencePaths", "url"],
          visualPath,
        );
        const references = visual.referencePaths;
        if (references !== undefined && !Array.isArray(references))
          fail("expected-array", `${visualPath}.referencePaths`);
        const referencePaths =
          references === undefined
            ? undefined
            : (references as unknown[]).map((reference, referenceIndex) =>
                artifactPath(
                  reference,
                  `${visualPath}.referencePaths[${referenceIndex}]`,
                ),
              );
        if (
          referencePaths !== undefined &&
          new Set(referencePaths).size !== referencePaths.length
        )
          fail("duplicate-value", `${visualPath}.referencePaths`);
        return {
          screenshotPath: artifactPath(
            visual.screenshotPath,
            `${visualPath}.screenshotPath`,
          ),
          ...(visual.caption === undefined
            ? {}
            : { caption: singleLine(visual.caption, `${visualPath}.caption`) }),
          ...(referencePaths === undefined ? {} : { referencePaths }),
          ...(visual.url === undefined
            ? {}
            : { url: safeUrl(visual.url, `${visualPath}.url`) }),
        };
      },
    ),
    ...(parsed.runCostReport === undefined
      ? {}
      : {
          runCostReport: implementationRunCost(
            parsed.runCostReport,
            `${path}.runCostReport`,
          ),
        }),
  };
}
function implementationFinish(value: unknown, path: string) {
  const allowed = [
    "costPublicationCompleted",
    "visualEvidenceValidated",
    "handoffCommentPosted",
    "cleanupHookCompleted",
    "doneLabelEnsured",
    "doneLabelApplied",
  ];
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("expected-object", path);
  const parsed = value as Record<string, unknown>;
  for (const key of Object.keys(parsed))
    if (!allowed.includes(key)) fail("unknown-key", `${path}.${key}`);
  for (const key of Object.keys(parsed))
    if (parsed[key] !== true) fail("invalid-checkpoint", `${path}.${key}`);
  for (let index = 1; index < allowed.length; index += 1)
    if (
      parsed[allowed[index]!] === true &&
      parsed[allowed[index - 1]!] !== true
    )
      fail("skipped-finish-checkpoint", `${path}.${allowed[index]}`);
  return parsed;
}
function phaseState(value: unknown, path: string): PlanningPhaseStateV1 {
  const raw = value as Record<string, unknown>;
  const status = raw?.status;
  const implementation = raw?.kind === "implementation";
  const keys =
    status === "pending"
      ? ["kind", "status"]
      : status === "workspace-ready"
        ? ["kind", "status", "base", "workspace", "artifacts"]
        : status === "branch-pushed"
          ? [
              "kind",
              "status",
              "base",
              "workspace",
              "artifacts",
              "publication",
              ...(implementation ? ["implementation"] : []),
            ]
          : status === "pull-request-open"
            ? [
                "kind",
                "status",
                "base",
                "workspace",
                "artifacts",
                "publication",
                "pullRequest",
                ...(implementation ? ["implementation", "finish"] : []),
              ]
            : raw?.completion &&
                (raw.completion as Record<string, unknown>).kind ===
                  "remote-base"
              ? ["kind", "status", "base", "artifacts", "completion"]
              : [
                  "kind",
                  "status",
                  "base",
                  "workspace",
                  "artifacts",
                  "publication",
                  "pullRequest",
                  ...(implementation ? ["implementation", "finish"] : []),
                  "completion",
                ];
  const parsed = object(value, keys, path);
  const kind = phase(parsed.kind, `${path}.kind`);
  if (parsed.status === "pending") return { kind, status: "pending" };
  if (parsed.status === "workspace-ready")
    return {
      kind,
      status: "workspace-ready",
      base: base(parsed.base, `${path}.base`),
      workspace: workspace(
        parsed.workspace,
        `${path}.workspace`,
      ) as PlanningWorkspaceOwnership<{ state: "ready" }>,
      artifacts: artifacts(parsed.artifacts, `${path}.artifacts`),
    };
  if (parsed.status === "branch-pushed") {
    const workspaceEvidence = workspace(
      parsed.workspace,
      `${path}.workspace`,
    ) as PlanningWorkspaceOwnership<{ state: "ready" }>;
    const publicationEvidence = publication(
      parsed.publication,
      `${path}.publication`,
    );
    if (kind === "implementation") {
      const evidence = implementationEvidence(
        parsed.implementation,
        `${path}.implementation`,
      );
      if (
        evidence.branch !== workspaceEvidence.identity.branch ||
        publicationEvidence.headOid !== workspaceEvidence.headOid
      )
        fail("implementation-mismatch", `${path}.implementation`);
      return {
        kind,
        status: "branch-pushed",
        base: base(parsed.base, `${path}.base`),
        workspace: workspaceEvidence,
        artifacts: artifacts(parsed.artifacts, `${path}.artifacts`),
        publication: publicationEvidence,
        implementation: evidence,
      };
    }
    return {
      kind,
      status: "branch-pushed",
      base: base(parsed.base, `${path}.base`),
      workspace: workspaceEvidence,
      artifacts: artifacts(parsed.artifacts, `${path}.artifacts`),
      publication: publicationEvidence,
    };
  }
  if (parsed.status === "pull-request-open") {
    const workspaceEvidence = workspace(parsed.workspace, `${path}.workspace`);
    const publicationEvidence = publication(
      parsed.publication,
      `${path}.publication`,
    );
    const pullRequestEvidence = pullRequest(
      parsed.pullRequest,
      `${path}.pullRequest`,
    );
    if (kind === "implementation") {
      const evidence = implementationEvidence(
        parsed.implementation,
        `${path}.implementation`,
      );
      if (
        evidence.branch !== workspaceEvidence.identity.branch ||
        evidence.prUrl !== pullRequestEvidence.url ||
        publicationEvidence.headOid !== workspaceEvidence.headOid
      )
        fail("implementation-mismatch", `${path}.implementation`);
      return {
        kind,
        status: "pull-request-open",
        base: base(parsed.base, `${path}.base`),
        workspace: workspaceEvidence,
        artifacts: artifacts(parsed.artifacts, `${path}.artifacts`),
        publication: publicationEvidence,
        pullRequest: pullRequestEvidence,
        implementation: evidence,
        finish: implementationFinish(parsed.finish, `${path}.finish`),
      };
    }
    return {
      kind,
      status: "pull-request-open",
      base: base(parsed.base, `${path}.base`),
      workspace: workspaceEvidence,
      artifacts: artifacts(parsed.artifacts, `${path}.artifacts`),
      publication: publicationEvidence,
      pullRequest: pullRequestEvidence,
    };
  }
  if (parsed.status !== "complete") fail("invalid-status", `${path}.status`);
  const completion = parsed.completion as Record<string, unknown>;
  if (completion?.kind === "remote-base") {
    if (kind === "implementation")
      fail("implementation-completion", `${path}.completion.kind`);
    object(completion, ["kind"], `${path}.completion`);
    return {
      kind: kind as "spec" | "plan",
      status: "complete",
      base: base(parsed.base, `${path}.base`),
      artifacts: artifacts(parsed.artifacts, `${path}.artifacts`),
      completion: { kind: "remote-base" },
    };
  }
  if (kind === "implementation") {
    const terminal = object(completion, ["kind"], `${path}.completion`);
    if (terminal.kind !== "implementation-pull-request")
      fail("implementation-completion", `${path}.completion.kind`);
    const workspaceEvidence = workspace(
      parsed.workspace,
      `${path}.workspace`,
    ) as PlanningWorkspaceOwnership<{
      state: "removed";
      pushedHeadOid: string;
    }>;
    const publicationEvidence = publication(
      parsed.publication,
      `${path}.publication`,
    );
    const pullRequestEvidence = pullRequest(
      parsed.pullRequest,
      `${path}.pullRequest`,
    );
    const evidence = implementationEvidence(
      parsed.implementation,
      `${path}.implementation`,
    );
    const finish = implementationFinish(parsed.finish, `${path}.finish`);
    if (
      workspaceEvidence.cleanup.state !== "removed" ||
      evidence.branch !== workspaceEvidence.identity.branch ||
      evidence.prUrl !== pullRequestEvidence.url ||
      publicationEvidence.headOid !== workspaceEvidence.headOid ||
      Object.keys(finish).length !== 6
    )
      fail("implementation-mismatch", path);
    return {
      kind,
      status: "complete",
      base: base(parsed.base, `${path}.base`),
      workspace: workspaceEvidence,
      artifacts: artifacts(parsed.artifacts, `${path}.artifacts`),
      publication: publicationEvidence,
      pullRequest: pullRequestEvidence,
      implementation: evidence,
      finish: finish as Required<PlanningImplementationFinishCheckpoints>,
      completion: { kind: "implementation-pull-request" },
    };
  }
  const merged = object(
    completion,
    ["kind", "mergeOid", "mergedBaseOid"],
    `${path}.completion`,
  );
  if (merged.kind !== "merged-pull-request")
    fail("invalid-completion", `${path}.completion.kind`);
  return {
    kind: kind as "spec" | "plan",
    status: "complete",
    base: base(parsed.base, `${path}.base`),
    workspace: workspace(
      parsed.workspace,
      `${path}.workspace`,
    ) as PlanningWorkspaceOwnership<{
      state: "removed";
      pushedHeadOid: string;
    }>,
    artifacts: artifacts(parsed.artifacts, `${path}.artifacts`),
    publication: publication(parsed.publication, `${path}.publication`),
    pullRequest: pullRequest(parsed.pullRequest, `${path}.pullRequest`),
    completion: {
      kind: "merged-pull-request",
      mergeOid: oid(merged.mergeOid, `${path}.completion.mergeOid`),
      mergedBaseOid: oid(
        merged.mergedBaseOid,
        `${path}.completion.mergedBaseOid`,
      ),
    },
  };
}
function artifactEvidence(
  phase: PlanningPhaseStateV1,
  assigned: readonly PlanningArtifactKind[],
  path: string,
): void {
  if (!("artifacts" in phase)) return;
  const complete = phase.status !== "workspace-ready";
  if (
    (complete && phase.artifacts.length !== assigned.length) ||
    phase.artifacts.some((artifact, index) => artifact.kind !== assigned[index])
  )
    fail("artifact-kinds", `${path}.artifacts`);
  for (const [index, artifact] of phase.artifacts.entries()) {
    if (
      phase.status === "complete" &&
      phase.completion.kind === "merged-pull-request"
    ) {
      if (
        artifact.source !== "remote-base" ||
        artifact.commitOid !== phase.completion.mergedBaseOid
      )
        fail("merged-artifact-mismatch", `${path}.artifacts[${index}]`);
    } else if (artifact.source === "remote-base") {
      if (
        artifact.commitOid !== phase.base.baseOid ||
        !phase.base.artifactCandidates[artifact.kind].includes(artifact.path)
      )
        fail("remote-artifact-mismatch", `${path}.artifacts[${index}]`);
    } else if (
      !("workspace" in phase) ||
      (phase.kind !== "implementation" &&
        artifact.commitOid !== phase.workspace.headOid)
    )
      fail("workspace-artifact-mismatch", `${path}.artifacts[${index}]`);
  }
}
function canonicalPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .reduce<string[]>(
      (out, part) =>
        part === "" || part === "."
          ? out
          : part === ".."
            ? (out.pop(), out)
            : [...out, part],
      [],
    )
    .join("/");
}
export function validatePlanningState(value: unknown): PlanningStateV1 {
  const parsed = object(
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
  if (parsed.version !== 1) fail("unsupported-version", "$.version");
  if (parsed.workflowVersion !== PLANNING_PR_WORKFLOW_VERSION)
    fail("unsupported-workflow-version", "$.workflowVersion");
  const runId = string(parsed.runId, "$.runId");
  if (!UUID.test(runId)) fail("invalid-uuid", "$.runId");
  const gates = object(
    parsed.gates,
    ["specRequired", "planRequired"],
    "$.gates",
  );
  if (
    typeof gates.specRequired !== "boolean" ||
    typeof gates.planRequired !== "boolean"
  )
    fail("invalid-gates", "$.gates");
  if (!Array.isArray(parsed.phases)) fail("expected-array", "$.phases");
  const phases = (parsed.phases as unknown[]).map(
    (item: unknown, index: number) => phaseState(item, `$.phases[${index}]`),
  );
  const expected = planningPhasePlan(gates as PlanningGateSnapshot);
  if (
    phases.length !== expected.length ||
    phases.some(
      (item: PlanningPhaseStateV1, index: number) =>
        item.kind !== expected[index]?.kind,
    )
  )
    fail("phase-sequence", "$.phases");
  let active = false;
  let pending = false;
  const branches = new Set<string>();
  const paths = new Set<string>();
  for (const [index, item] of phases.entries()) {
    const path = `$.phases[${index}]`;
    if (item.status === "pending") pending = true;
    else if (item.status === "complete") {
      if (active || pending) fail("progress-order", path);
    } else {
      if (active || pending) fail("progress-order", path);
      active = true;
    }
    artifactEvidence(item, expected[index]!.artifactKinds, path);
    if (!("workspace" in item)) continue;
    if (
      item.workspace.runId !== runId ||
      item.workspace.phase !== item.kind ||
      item.workspace.remote !== item.base.remote ||
      item.workspace.baseBranch !== item.base.baseBranch ||
      item.workspace.baseOid !== item.base.baseOid
    )
      fail("workspace-mismatch", `${path}.workspace`);
    if (
      branches.has(item.workspace.identity.branch) ||
      paths.has(canonicalPath(item.workspace.identity.worktreePath))
    )
      fail("duplicate-workspace-identity", `${path}.workspace.identity`);
    branches.add(item.workspace.identity.branch);
    paths.add(canonicalPath(item.workspace.identity.worktreePath));
    if (
      (item.status === "workspace-ready" || item.status === "branch-pushed") &&
      item.workspace.cleanup.state !== "ready"
    )
      fail("invalid-cleanup-progress", `${path}.workspace.cleanup`);
    if (
      item.workspace.cleanup.state !== "ready" &&
      item.workspace.cleanup.pushedHeadOid !== item.workspace.headOid
    )
      fail("cleanup-head-mismatch", `${path}.workspace.cleanup.pushedHeadOid`);
    if (
      "publication" in item &&
      (item.publication.baseBranch !== item.base.baseBranch ||
        item.publication.headBranch !== item.workspace.identity.branch ||
        item.publication.headOid !== item.workspace.headOid)
    )
      fail("publication-mismatch", `${path}.publication`);
    if (
      "pullRequest" in item &&
      !sameRepositoryIdentity(
        item.pullRequest.reference.targetRepository,
        item.publication.targetRepository,
      )
    )
      fail("pull-request-mismatch", `${path}.pullRequest`);
    if (
      item.status === "complete" &&
      item.completion.kind === "merged-pull-request" &&
      item.workspace.cleanup.state !== "removed"
    )
      fail("invalid-cleanup-progress", `${path}.workspace.cleanup`);
  }
  const createdAt = timestamp(parsed.createdAt, "$.createdAt");
  const updatedAt = timestamp(parsed.updatedAt, "$.updatedAt");
  if (updatedAt < createdAt) fail("timestamp-order", "$.updatedAt");
  return {
    version: 1,
    workflowVersion: PLANNING_PR_WORKFLOW_VERSION,
    runId,
    issueNumber: positive(parsed.issueNumber, "$.issueNumber"),
    issueTitle: singleLine(parsed.issueTitle, "$.issueTitle"),
    gates: gates as PlanningGateSnapshot,
    phases,
    revision: nonnegative(parsed.revision, "$.revision"),
    createdAt,
    updatedAt,
  };
}
