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
  policyText: string;
  targetBranch: string;
};

export type PatchmillVisualEvidencePolicy = {
  policyText: string;
  webScreenshotSkill?: string;
  mobileScreenshotSkill?: string;
  referenceScreenshotPaths?: string[];
  reviewerExpectations?: string[];
  prEvidenceExample?: {
    screenshotPath: string;
    caption?: string;
    referencePaths?: string[];
  };
};

export type PatchmillPiWorkflowPolicy = {
  todoWorkflowInstruction: string;
  subagentWorkflowInstruction: string;
  taskContract: PatchmillPiTaskContract;
};

export type PatchmillProjectPolicy = {
  projectName?: string;
  contextFileNames: string[];
  toolchainInstruction: string;
  validation: PatchmillValidationPolicy;
  directLand: PatchmillDirectLandPolicy;
  visualEvidence: PatchmillVisualEvidencePolicy;
  hostToolingInstruction: string;
  pi: PatchmillPiWorkflowPolicy;
  planRequiresApproval: boolean;
};
