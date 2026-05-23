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
};

export type PatchmillPiWorkflowPolicy = {
  todoWorkflowInstruction: string;
  subagentWorkflowInstruction: string;
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
