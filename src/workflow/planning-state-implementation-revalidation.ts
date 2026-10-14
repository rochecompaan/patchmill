import { isDeepStrictEqual } from "node:util";
import type {
  PlanningPhaseStateV1,
  PlanningWorkspaceEvidence,
} from "./planning-state-types.ts";
import { PlanningStateValidationError } from "./planning-state-validation.ts";

function identity(workspace: PlanningWorkspaceEvidence) {
  const { headOid: _head, cleanup: _cleanup, ...stable } = workspace;
  return stable;
}

/** Invalidate checks without changing ownership, artifacts, base, or merge proof. */
export function assertImplementationRevalidation(
  current: PlanningPhaseStateV1,
  next: PlanningPhaseStateV1,
  index: number,
): boolean {
  if (
    current.kind !== "implementation" ||
    next.kind !== "implementation" ||
    next.status !== "workspace-ready" ||
    (current.status !== "branch-pushed" &&
      current.status !== "pull-request-open")
  )
    return false;
  if (
    (current.status === "pull-request-open" && current.merge !== undefined) ||
    !isDeepStrictEqual(current.base, next.base) ||
    !isDeepStrictEqual(current.artifacts, next.artifacts) ||
    !isDeepStrictEqual(identity(current.workspace), identity(next.workspace)) ||
    next.workspace.cleanup.state !== "ready"
  )
    throw new PlanningStateValidationError(
      "immutable-evidence",
      `$.phases[${index}]`,
    );
  return true;
}
