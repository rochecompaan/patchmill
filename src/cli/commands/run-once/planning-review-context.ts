export type PlanningReviewContext =
  | "dedicated-pull-request"
  | "same-phase-pull-request"
  | "merged-base"
  | "implementation-pull-request"
  | "legacy-label";

export function planningReviewInstruction(
  context: PlanningReviewContext,
): string | undefined {
  switch (context) {
    case "dedicated-pull-request":
      return "Review this artifact in the current planning pull request.";
    case "same-phase-pull-request":
      return "Review the spec and plan together in the current planning pull request; do not call the spec already approved.";
    case "merged-base":
      return "Use the verified merged-base spec as source material for this artifact.";
    case "implementation-pull-request":
      return "Carry this artifact with implementation code; no planning pull request is created for it.";
    case "legacy-label":
      return undefined;
  }
}

export function specSourceInstruction(
  context: PlanningReviewContext,
  specPath: string | undefined,
): string {
  if (specPath === undefined)
    return "No separate spec artifact was found; write the minimum design context needed in the implementation plan before task steps.";
  switch (context) {
    case "same-phase-pull-request":
      return `Read and base the implementation plan on the current-phase spec at ${specPath}; it is not yet approved.`;
    case "merged-base":
      return `Read and base the implementation plan on the verified merged-base spec at ${specPath}.`;
    case "implementation-pull-request":
      return `Read and base the implementation plan on the implementation-carried spec at ${specPath}.`;
    case "dedicated-pull-request":
    case "legacy-label":
      return `Read and base the implementation plan on the approved spec at ${specPath}.`;
  }
}
