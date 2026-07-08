import type { PartialPatchmillSkillsConfig } from "../workflow/skills.ts";
import type { PatchmillConfig } from "./types.ts";
import type { PartialWorkflowConfig } from "./workflow.ts";

type PartialPiTaskContract = Partial<
  PatchmillConfig["projectPolicy"]["pi"]["taskContract"]
>;

type PartialPiWorkflowPolicy = Partial<
  Omit<PatchmillConfig["projectPolicy"]["pi"], "taskContract">
> & {
  taskContract?: PartialPiTaskContract;
};

type PartialProjectPolicy = Partial<
  Omit<
    PatchmillConfig["projectPolicy"],
    "validation" | "directLand" | "visualEvidence" | "pi"
  >
> & {
  validation?: Partial<PatchmillConfig["projectPolicy"]["validation"]>;
  directLand?: Partial<PatchmillConfig["projectPolicy"]["directLand"]>;
  visualEvidence?: Partial<PatchmillConfig["projectPolicy"]["visualEvidence"]>;
  pi?: PartialPiWorkflowPolicy;
};

export type PartialConfig = Partial<{
  host: Partial<PatchmillConfig["host"]>;
  pi: Partial<PatchmillConfig["pi"]>;
  paths: Partial<PatchmillConfig["paths"]>;
  labels: Partial<PatchmillConfig["labels"]>;
  triage: Partial<PatchmillConfig["triage"]>;
  workflow: PartialWorkflowConfig;
  skills: PartialPatchmillSkillsConfig;
  git: Partial<PatchmillConfig["git"]>;
  cleanupHook: string;
  projectPolicy: PartialProjectPolicy;
}>;
