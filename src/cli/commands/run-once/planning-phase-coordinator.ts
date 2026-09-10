import { planningPhasePlan } from "../../../workflow/planning-pull-requests.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
import type {
  AgentIssueBlockedResult,
  AgentIssuePrCreatedResult,
  IssueSummary,
} from "./types.ts";

export type PlanningCoordinatorOutcome =
  | {
      kind: "review-pending";
      state: PlanningStateV1;
      phase: "spec" | "plan";
      prUrl: string;
    }
  | {
      kind: "stopped";
      state: PlanningStateV1;
      reason: "plan-only";
      nextPhase: "implementation";
    }
  | { kind: "blocked"; state: PlanningStateV1; result: AgentIssueBlockedResult }
  | {
      kind: "complete";
      state: PlanningStateV1;
      result: AgentIssuePrCreatedResult;
    };

export type PlanningPhaseRunnerOutcome =
  | { kind: "review-pending"; state: PlanningStateV1; prUrl: string }
  | { kind: "blocked"; state: PlanningStateV1; result: AgentIssueBlockedResult }
  | {
      kind: "complete";
      state: PlanningStateV1;
      result: AgentIssuePrCreatedResult;
    }
  | { kind: "advanced"; state: PlanningStateV1 };

export type PlanningPhaseCoordinatorInput = {
  state: PlanningStateV1;
  issue: IssueSummary;
  planOnly?: boolean;
  /**
   * Effect boundary composed by the planning pipeline from issue #188's
   * reconciler, artifact runner, publisher, implementation validator, and
   * finish wrapper. A completed planning phase returns a revised durable state
   * so this coordinator can advance only through the strict completed prefix.
   */
  runPlanningPhase(input: {
    state: PlanningStateV1;
    phaseIndex: number;
    phase: ReturnType<typeof planningPhasePlan>[number];
  }): Promise<PlanningPhaseRunnerOutcome>;
};

export async function coordinatePlanningPhases(
  input: PlanningPhaseCoordinatorInput,
): Promise<PlanningCoordinatorOutcome> {
  let state = input.state;
  const plan = planningPhasePlan(state.gates);
  for (;;) {
    const phaseIndex = state.phases.findIndex(
      (phase) => phase.status !== "complete",
    );
    if (phaseIndex < 0)
      throw new Error("Planning state has no implementation result");
    const phase = plan[phaseIndex];
    if (phase === undefined)
      throw new Error("Planning phase plan is inconsistent");
    if (phase.kind === "implementation" && input.planOnly) {
      return {
        kind: "stopped",
        state,
        reason: "plan-only",
        nextPhase: "implementation",
      };
    }
    const outcome = await input.runPlanningPhase({ state, phaseIndex, phase });
    if (outcome.kind === "review-pending") {
      if (phase.kind === "implementation")
        throw new Error("Implementation pull request cannot be review-pending");
      return {
        kind: "review-pending",
        state: outcome.state,
        phase: phase.kind,
        prUrl: outcome.prUrl,
      };
    }
    if (outcome.kind === "blocked") return outcome;
    if (outcome.kind === "complete") return outcome;
    state = outcome.state;
  }
}
