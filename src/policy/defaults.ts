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
    referenceScreenshotPaths: ["docs/screenshots"],
    prEvidenceExample: {
      screenshotPath: "docs/screenshots/example-screen.png",
      caption: "Reference screenshot for the changed UI state",
    },
  },
  pi: {
    taskContract: DEFAULT_PI_TASK_CONTRACT,
  },
  planRequiresApproval: false,
};
