import { renderConfiguredSkillLine, type PatchmillSkillsConfig } from "../../src/workflow/skills.ts";

export function renderPlanningSkillStep(skills: PatchmillSkillsConfig): string {
  return renderConfiguredSkillLine("Use the configured planning skill", skills.planning);
}

export function renderImplementationSkillSteps(skills: PatchmillSkillsConfig): string[] {
  return [
    renderConfiguredSkillLine("Use the configured toolchain skill before setup or validation commands", skills.toolchain),
    renderConfiguredSkillLine("Use the configured implementation skill", skills.implementation),
    renderConfiguredSkillLine("Use the configured review skill for explicit review passes", skills.review),
  ].filter((line) => line.length > 0);
}

export function renderVisualEvidenceSkillStep(skills: PatchmillSkillsConfig): string {
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
