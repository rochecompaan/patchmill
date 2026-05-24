import { DEFAULT_PI_TASK_CONTRACT } from "./task-contract.ts";
import type { PatchmillProjectPolicy } from "./types.ts";

export const DEFAULT_PATCHMILL_POLICY: PatchmillProjectPolicy = {
  contextFileNames: ["AGENTS.md"],
  validation: {
    rules: [],
    forbiddenSubstitutions: [],
  },
  directLand: {
    targetBranch: "main",
  },
  visualEvidence: {
    prEvidenceExample: {
      screenshotPath: ".tmp/issue-42-after.png",
      caption: "Visible UI state after the change",
    },
  },
  pi: {
    taskContract: DEFAULT_PI_TASK_CONTRACT,
  },
  planRequiresApproval: false,
};
