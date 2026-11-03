import { dirname } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import { resolvePhaseSkill } from "../kernel/phase-skill.ts";

export function consoleSkillPaths(
  config: PatchmillConfig,
  repoRoot: string,
): string[] {
  return [
    ...new Set(
      (["planning", "implementation"] as const).map((phase) =>
        dirname(resolvePhaseSkill(config, repoRoot, phase).path),
      ),
    ),
  ];
}
