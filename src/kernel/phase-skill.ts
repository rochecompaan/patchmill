import { resolve } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import type { Phase } from "./phase.ts";

export function resolvePhaseSkill(
  config: PatchmillConfig,
  repoRoot: string,
  phase: Phase,
): { name: string; path: string } {
  return { name: phase, path: resolve(repoRoot, config.skills[phase]) };
}
