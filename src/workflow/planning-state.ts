import { randomUUID } from "node:crypto";
import { PLANNING_PR_WORKFLOW_VERSION } from "./planning-pull-request-markers.ts";
import {
  planningPhasePlan,
  type PlanningGateSnapshot,
} from "./planning-pull-requests.ts";
import type { PlanningStateV1 } from "./planning-state-types.ts";
import {
  PlanningStateValidationError,
  validatePlanningState as validate,
} from "./planning-state-validation.ts";

export * from "./planning-state-types.ts";
export { PlanningStateValidationError } from "./planning-state-validation.ts";

export function createPlanningState(input: {
  issueNumber: number;
  issueTitle: string;
  gates: PlanningGateSnapshot;
  runId?: string;
  now?: string;
}): PlanningStateV1 {
  const now = input.now ?? new Date().toISOString();
  return validate({
    version: 1,
    workflowVersion: PLANNING_PR_WORKFLOW_VERSION,
    runId: input.runId ?? randomUUID(),
    issueNumber: input.issueNumber,
    issueTitle: input.issueTitle,
    gates: input.gates,
    phases: planningPhasePlan(input.gates).map(({ kind }) => ({
      kind,
      status: "pending",
    })),
    revision: 0,
    createdAt: now,
    updatedAt: now,
  });
}
export function validatePlanningState(value: unknown): PlanningStateV1 {
  return validate(value);
}
export function parsePlanningState(raw: string): PlanningStateV1 {
  try {
    return validate(JSON.parse(raw) as unknown);
  } catch (error) {
    if (error instanceof PlanningStateValidationError) throw error;
    throw new PlanningStateValidationError("invalid-json", "$");
  }
}
export function serializePlanningState(state: PlanningStateV1): string {
  return `${JSON.stringify(validate(state), null, 2)}\n`;
}
export function assertPlanningStateReplacement(
  current: PlanningStateV1,
  next: PlanningStateV1,
): void {
  const left = validate(current);
  const right = validate(next);
  for (const key of [
    "version",
    "workflowVersion",
    "runId",
    "issueNumber",
    "issueTitle",
    "createdAt",
  ] as const)
    if (left[key] !== right[key])
      throw new PlanningStateValidationError("immutable-field", `$.${key}`);
  if (
    JSON.stringify(left.gates) !== JSON.stringify(right.gates) ||
    left.phases.map((p) => p.kind).join() !==
      right.phases.map((p) => p.kind).join()
  )
    throw new PlanningStateValidationError("immutable-field", "$.phases");
  if (right.revision !== left.revision + 1)
    throw new PlanningStateValidationError("revision-step", "$.revision");
  if (right.updatedAt < left.updatedAt)
    throw new PlanningStateValidationError("timestamp-order", "$.updatedAt");
  for (let index = 0; index < left.phases.length; index += 1) {
    const a = left.phases[index]!;
    const b = right.phases[index]!;
    const allowed: Record<string, readonly string[]> = {
      pending: ["pending", "workspace-ready", "complete"],
      "workspace-ready": ["workspace-ready", "pull-request-open"],
      "pull-request-open": ["pull-request-open", "complete"],
      complete: ["complete"],
    };
    if (!allowed[a.status]!.includes(b.status))
      throw new PlanningStateValidationError(
        "invalid-transition",
        `$.phases[${index}].status`,
      );
    if (a.status === "complete" && b.status === "complete") {
      const ak = a.completion.kind;
      const bk = b.completion.kind;
      if (ak !== bk)
        throw new PlanningStateValidationError(
          "invalid-transition",
          `$.phases[${index}].completion`,
        );
      if (ak === "merged-pull-request" && bk === "merged-pull-request") {
        const leftMerged = a as Extract<
          typeof a,
          { completion: { kind: "merged-pull-request" } }
        >;
        const rightMerged = b as Extract<
          typeof b,
          { completion: { kind: "merged-pull-request" } }
        >;
        if (
          leftMerged.workspace.cleanup.state !==
          rightMerged.workspace.cleanup.state
        ) {
          const edges: Record<string, string> = {
            ready: "worktree-removed",
            "worktree-removed": "removed",
          };
          if (
            edges[leftMerged.workspace.cleanup.state] !==
            rightMerged.workspace.cleanup.state
          )
            throw new PlanningStateValidationError(
              "invalid-cleanup-transition",
              `$.phases[${index}].workspace.cleanup`,
            );
        }
      }
    }
  }
}
