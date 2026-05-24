import type { PatchmillPiTaskContract } from "./task-contract.ts";

export type PatchmillValidationRule = {
  category: string;
  commands: string[];
};

export type PatchmillValidationPolicy = {
  rules: PatchmillValidationRule[];
  forbiddenSubstitutions: string[];
};

export type PatchmillDirectLandPolicy = {
  targetBranch: string;
};

export type PatchmillVisualEvidencePolicy = {
  referenceScreenshotPaths?: string[];
  prEvidenceExample?: {
    screenshotPath: string;
    caption?: string;
    referencePaths?: string[];
  };
};

export type PatchmillPiWorkflowPolicy = {
  taskContract: PatchmillPiTaskContract;
};

export type PatchmillProjectPolicy = {
  projectName?: string;
  contextFileNames: string[];
  validation: PatchmillValidationPolicy;
  directLand: PatchmillDirectLandPolicy;
  visualEvidence: PatchmillVisualEvidencePolicy;
  pi: PatchmillPiWorkflowPolicy;
  planRequiresApproval: boolean;
};
