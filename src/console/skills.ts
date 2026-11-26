import { dirname, resolve } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import { resolvePhaseSkill } from "../kernel/phase-skill.ts";

/** The skill pack folders that the Console agent loads. */
export function consoleSkillPaths(
  config: PatchmillConfig,
  repoRoot: string,
): string[] {
  return [
    ...new Set([
      ...(["planning", "implementation"] as const).map((phase) =>
        dirname(resolvePhaseSkill(config, repoRoot, phase).path),
      ),
      dirname(resolve(repoRoot, config.skills.retro)),
    ]),
  ];
}
