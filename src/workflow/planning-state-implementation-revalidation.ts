import { isDeepStrictEqual } from "node:util";
import type {
  PlanningPhaseStateV1,
  PlanningWorkspaceEvidence,
  ImplementationBranchPushedPlanningPhase,
  ImplementationPullRequestOpenPlanningPhase,
  PlanningImplementationRevalidationEvidence,
} from "./planning-state-types.ts";
import { PlanningStateValidationError } from "./planning-state-validation.ts";

function identity(workspace: PlanningWorkspaceEvidence) {
  const { headOid: _head, cleanup: _cleanup, ...stable } = workspace;
  return stable;
}

export function implementationRecoveryReceipt(
  phase:
    | ImplementationBranchPushedPlanningPhase
    | ImplementationPullRequestOpenPlanningPhase,
): PlanningImplementationRevalidationEvidence {
  if ("revalidation" in phase && phase.revalidation) return phase.revalidation;
  return {
    publication: phase.publication,
    implementation: phase.implementation,
    ...(phase.status !== "pull-request-open"
      ? {}
      : {
          pullRequest: phase.pullRequest,
          finish: phase.finish,
          ...(phase.observedHeadOid === undefined
            ? {}
            : { observedHeadOid: phase.observedHeadOid }),
        }),
  };
}

/** Invalidation keeps durable ownership and receipts; only verified preparation may make them ready. */
export function assertImplementationRevalidation(
  current: PlanningPhaseStateV1,
  next: PlanningPhaseStateV1,
  index: number,
): boolean {
  if (current.kind !== "implementation" || next.kind !== "implementation")
    return false;
  const fail = (): never => {
    throw new PlanningStateValidationError(
      "immutable-evidence",
      `$.phases[${index}]`,
    );
  };
  const same = (left: unknown, right: unknown) => {
    if (!isDeepStrictEqual(left, right)) fail();
  };
  if (next.status === "revalidation-pending") {
    if (
      current.status === "branch-pushed" ||
      current.status === "pull-request-open"
    ) {
      if (current.status === "pull-request-open" && current.merge !== undefined)
        fail();
      same(current.base, next.base);
      same(current.artifacts, next.artifacts);
      same(current.workspace, next.workspace);
      same(implementationRecoveryReceipt(current), next.revalidation);
      return true;
    }
    if (current.status === "workspace-ready" && current.revalidation) {
      same(current.base, next.base);
      same(current.artifacts, next.artifacts);
      same(current.workspace, next.workspace);
      same(current.revalidation, next.revalidation);
      return true;
    }
    if (current.status !== "revalidation-pending") return fail();
    same(current.base, next.base);
    same(current.artifacts, next.artifacts);
    same(current.workspace, next.workspace);
    const { observedHeadOid: _currentObserved, ...saved } =
      current.revalidation;
    const { observedHeadOid: _nextObserved, ...observed } = next.revalidation;
    same(saved, observed);
    return true;
  }
  if (current.status === "revalidation-pending") {
    same(current.base, next.status === "pending" ? undefined : next.base);
    if (!("workspace" in next)) return fail();
    same(identity(current.workspace), identity(next.workspace));
    same(current.artifacts, next.artifacts);
    if (next.status === "workspace-ready") {
      same(current.revalidation, next.revalidation);
      if (next.workspace.cleanup.state !== "ready") fail();
      return true;
    }
    if (next.status === "pull-request-open" && next.merge !== undefined) {
      same(current.workspace, next.workspace);
      same(current.revalidation.publication, next.publication);
      same(current.revalidation.implementation, next.implementation);
      if (current.revalidation.pullRequest)
        same(current.revalidation.pullRequest, next.pullRequest);
      else
        same(current.revalidation.implementation.prUrl, next.pullRequest.url);
      same(current.revalidation.finish ?? {}, next.finish);
      return true;
    }
    fail();
  }
  if ("revalidation" in current && current.revalidation) {
    if (
      current.status === "branch-pushed" &&
      next.status === "pull-request-open"
    ) {
      if (current.revalidation.pullRequest)
        same(current.revalidation.pullRequest, next.pullRequest);
      const { headOid: _priorHead, ...priorIdentity } =
        current.revalidation.publication;
      const { headOid: _newHead, ...newIdentity } = next.publication;
      same(priorIdentity, newIdentity);
    } else {
      same(
        current.revalidation,
        "revalidation" in next ? next.revalidation : undefined,
      );
    }
  } else if ("revalidation" in next && next.revalidation) fail();
  return false;
}
