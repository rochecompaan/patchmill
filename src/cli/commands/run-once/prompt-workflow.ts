import {
  renderConfiguredSkillLine,
  type PatchmillSkillsConfig,
} from "../../../workflow/skills.ts";

export function renderPlanningSkillStep(skills: PatchmillSkillsConfig): string {
  return renderConfiguredSkillLine(
    "Use the configured planning skill",
    skills.planning,
  );
}

export function renderPlanningExecutionHandoffStep(
  skills: PatchmillSkillsConfig,
): string {
  return [
    `Configured implementation choice: \`${skills.implementation}\`.`,
    "Record this choice in the plan and preserve any explicit operator execution method.",
    "Do not ask for another execution-method choice in this unattended phase.",
    "For inline-dev-with-validation-and-pr-checks, record Native through its sibling executing-plans skill.",
    "Keep existing planning review gates. This choice does not authorize implementation before approval.",
  ].join("\n");
}

export function renderImplementationSkillSteps(
  skills: PatchmillSkillsConfig,
): string[] {
  return [
    renderConfiguredSkillLine(
      "Use the configured toolchain skill before setup or validation commands",
      skills.toolchain,
    ),
    renderConfiguredSkillLine(
      "Use the configured implementation skill",
      skills.implementation,
    ),
    renderConfiguredSkillLine(
      "Use the configured review skill for explicit review passes",
      skills.review,
    ),
  ].filter((line) => line.length > 0);
}

export function renderDevelopmentEnvironmentSkillStep(
  skills: PatchmillSkillsConfig,
): string {
  return renderConfiguredSkillLine(
    "Use the configured development-environment skill",
    skills.developmentEnvironment,
  );
}

export function renderVisualEvidenceSkillStep(
  skills: PatchmillSkillsConfig,
): string {
  return renderConfiguredSkillLine(
    "If the issue changes visible UI, use the configured visual evidence skill",
    skills.visualEvidence,
  );
}

export function renderLandingSkillStep(skills: PatchmillSkillsConfig): string {
  return renderConfiguredSkillLine(
    "Use the configured landing skill for the direct-land versus PR decision",
    skills.landing,
  );
}
