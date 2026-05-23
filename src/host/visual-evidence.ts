import type { AgentIssueVisualEvidence } from "../../scripts/agent-issue/types.ts";

export type VisualEvidenceUploader = {
  uploadPrEvidence(input: {
    repoRoot: string;
    prUrl: string;
    evidence: AgentIssueVisualEvidence[] | undefined;
  }): Promise<AgentIssueVisualEvidence[]>;
};
