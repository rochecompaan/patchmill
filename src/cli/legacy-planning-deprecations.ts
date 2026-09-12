export type LegacyPlanningControl = "set-spec" | "set-plan" | "--plan-only";

export type LegacyPlanningDeprecation = Readonly<{
  warning: string;
  help: string;
}>;

const DEPRECATIONS: Readonly<
  Record<LegacyPlanningControl, LegacyPlanningDeprecation>
> = Object.freeze({
  "set-spec": Object.freeze({
    warning:
      "Deprecated: set-spec publishes artifact comments consumed only by unfinished legacy Issue runs. For fresh runs, use ordinary patchmill run-once --issue N to create a planning pull request, or commit the spec under the configured spec directory on the target base before Run-once starts.",
    help: "Deprecated; legacy Issue-run comment compatibility only. Fresh runs use ordinary Run-once planning pull requests or a target-base spec.",
  }),
  "set-plan": Object.freeze({
    warning:
      "Deprecated: set-plan publishes artifact comments consumed only by unfinished legacy Issue runs. For fresh runs, use ordinary patchmill run-once --issue N to create a planning pull request, or commit the plan under the configured plan directory on the target base before Run-once starts.",
    help: "Deprecated; legacy Issue-run comment compatibility only. Fresh runs use ordinary Run-once planning pull requests or a target-base plan.",
  }),
  "--plan-only": Object.freeze({
    warning:
      "Deprecated: --plan-only remains available for compatibility and does not select the legacy workflow or bypass an open planning review. Configure spec and plan review gates and use ordinary Run-once, or use the human-invoked patchmill-plan skill for local planning.",
    help: "Deprecated; use Run-once review gates for automated stops or patchmill-plan for human-controlled local planning.",
  }),
});

export function legacyPlanningDeprecation(
  control: LegacyPlanningControl,
): LegacyPlanningDeprecation {
  return DEPRECATIONS[control];
}
