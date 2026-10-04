import { requiredFilesForBundledSkillName } from "./bundled-skills.ts";

export const INLINE_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL =
  "inline-dev-with-validation-and-pr-checks";

export type SkillFileRequirement = {
  path: string;
  executable: boolean;
};

type InlineImplementationRuntimeFile = SkillFileRequirement & {
  skillName: string;
};

export const INLINE_IMPLEMENTATION_RUNTIME_FILES = [
  {
    skillName: INLINE_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL,
    path: "SKILL.md",
    executable: false,
  },
  {
    skillName: INLINE_DEV_WITH_VALIDATION_AND_PR_CHECKS_SKILL,
    path: "review-appendix.md",
    executable: false,
  },
  { skillName: "executing-plans", path: "SKILL.md", executable: false },
  {
    skillName: "executing-plans",
    path: "scripts/task-start",
    executable: true,
  },
  {
    skillName: "executing-plans",
    path: "scripts/task-done",
    executable: true,
  },
  {
    skillName: "subagent-driven-development",
    path: "scripts/sdd-workspace",
    executable: true,
  },
  {
    skillName: "subagent-driven-development",
    path: "scripts/task-brief",
    executable: true,
  },
  {
    skillName: "subagent-driven-development",
    path: "scripts/review-package",
    executable: true,
  },
  {
    skillName: "requesting-code-review",
    path: "SKILL.md",
    executable: false,
  },
  {
    skillName: "requesting-code-review",
    path: "code-reviewer.md",
    executable: false,
  },
] as const satisfies readonly InlineImplementationRuntimeFile[];

export function requiredRuntimeFiles(
  skillName: string,
): readonly SkillFileRequirement[] {
  const inlineRequirements = INLINE_IMPLEMENTATION_RUNTIME_FILES.filter(
    (requirement) => requirement.skillName === skillName,
  ).map(({ path, executable }) => ({ path, executable }));

  const requirements = new Map<string, SkillFileRequirement>(
    requiredFilesForBundledSkillName(skillName).map((path) => [
      path,
      { path, executable: false },
    ]),
  );
  for (const requirement of inlineRequirements) {
    requirements.set(requirement.path, requirement);
  }
  return [...requirements.values()];
}
