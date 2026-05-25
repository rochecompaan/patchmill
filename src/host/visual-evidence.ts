import type { AgentIssueVisualEvidence } from "../cli/commands/run-once/types.ts";

export type VisualEvidenceUploader = {
  uploadPrEvidence(input: {
    repoRoot: string;
    prUrl: string;
    evidence: AgentIssueVisualEvidence[] | undefined;
  }): Promise<AgentIssueVisualEvidence[]>;
};
