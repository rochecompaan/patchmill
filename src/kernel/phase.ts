import type { Facts } from "./facts.ts";

export type Phase = "planning" | "implementation";
export type Derived =
  | { kind: "phase"; phase: Phase }
  | { kind: "stop"; label: "done" | "specReview" };

export function derivePhase(facts: Facts, gateRequired: boolean): Derived {
  if (facts.pullRequest?.state === "merged")
    return { kind: "stop", label: "done" };
  if (facts.specPath === undefined) return { kind: "phase", phase: "planning" };
  if (gateRequired && !facts.specApproved)
    return { kind: "stop", label: "specReview" };
  if (facts.planPath === undefined) return { kind: "phase", phase: "planning" };
  return { kind: "phase", phase: "implementation" };
}
