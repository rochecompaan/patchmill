import type { Facts } from "./facts.ts";
import { wrongTarget } from "./pull-request.ts";

export type Phase = "planning" | "implementation";
export type Derived =
  | { kind: "phase"; phase: Phase }
  | { kind: "stop"; label: "done" | "inProgress" | "needsInfo" };

export function derivePhase(facts: Facts): Derived {
  if (facts.pullRequest && wrongTarget(facts.pullRequest, facts.baseBranch))
    return { kind: "stop", label: "needsInfo" };
  if (facts.stage !== "implementation") {
    if (facts.pullRequest?.state === "closed")
      return { kind: "stop", label: "needsInfo" };
    if (facts.pullRequest) return { kind: "stop", label: "inProgress" };
    return { kind: "phase", phase: "planning" };
  }
  if (facts.pullRequest?.state === "merged")
    return { kind: "stop", label: "done" };
  if (facts.specPath === undefined || facts.planPath === undefined)
    return { kind: "phase", phase: "planning" };
  return { kind: "phase", phase: "implementation" };
}
