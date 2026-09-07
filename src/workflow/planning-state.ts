import { randomUUID } from "node:crypto";
import { PLANNING_PR_WORKFLOW_VERSION } from "./planning-pull-request-markers.ts";
import {
  planningPhasePlan,
  type PlanningGateSnapshot,
} from "./planning-pull-requests.ts";
import { assertPlanningPhaseReplacement } from "./planning-state-transitions.ts";
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
  ] as const) {
    if (left[key] !== right[key]) {
      throw new PlanningStateValidationError("immutable-field", `$.${key}`);
    }
  }
  if (
    JSON.stringify(left.gates) !== JSON.stringify(right.gates) ||
    left.phases.map((phase) => phase.kind).join() !==
      right.phases.map((phase) => phase.kind).join()
  ) {
    throw new PlanningStateValidationError("immutable-field", "$.phases");
  }
  if (right.revision !== left.revision + 1) {
    throw new PlanningStateValidationError("revision-step", "$.revision");
  }
  if (right.updatedAt < left.updatedAt) {
    throw new PlanningStateValidationError("timestamp-order", "$.updatedAt");
  }
  for (let index = 0; index < left.phases.length; index += 1) {
    assertPlanningPhaseReplacement(
      left.phases[index]!,
      right.phases[index]!,
      index,
    );
  }
}
