import { DEFAULT_PI_TASK_CONTRACT } from "./task-contract.ts";
import type { PatchmillProjectPolicy } from "./types.ts";

export const DEFAULT_PATCHMILL_POLICY: PatchmillProjectPolicy = {
  contextFileNames: ["AGENTS.md"],
  toolchainInstruction: "Use the repository's documented development toolchain.",
  validation: {
    rules: [],
    forbiddenSubstitutions: [],
  },
  directLand: {
    targetBranch: "main",
    policyText: "Apply the repository's configured landing policy for the target branch.",
  },
  visualEvidence: {
    policyText: "Capture the visual evidence required by the repository whenever visible UI changes.",
    prEvidenceExample: {
      screenshotPath: ".tmp/issue-42-after.png",
      caption: "Visible UI state after the change",
    },
  },
  hostToolingInstruction: "Use the repository's configured host tooling for issue and pull-request actions.",
  pi: {
    todoWorkflowInstruction: "",
    subagentWorkflowInstruction:
      "Use the repository's documented Pi subagent workflow for implementation and review.",
    taskContract: DEFAULT_PI_TASK_CONTRACT,
  },
  planRequiresApproval: false,
};
