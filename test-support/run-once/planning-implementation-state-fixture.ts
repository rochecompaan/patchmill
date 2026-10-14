import type {
  ImplementationPullRequestOpenPlanningPhase,
  PlanningStateV1,
} from "../../src/workflow/planning-state-types.ts";

export const implementationOid = (letter: string) => letter.repeat(40);

export function publishedImplementationState(): PlanningStateV1 & {
  phases: readonly [ImplementationPullRequestOpenPlanningPhase];
} {
  const repository = {
    provider: "github-gh" as const,
    host: "github.com",
    owner: "test",
    repository: "repo",
  };
  const runId = "123e4567-e89b-42d3-a456-426614174000";
  const base = {
    remote: "origin",
    baseBranch: "main",
    baseOid: implementationOid("a"),
    artifactCandidates: { spec: [], plan: [] },
  };
  return {
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId,
    issueNumber: 189,
    issueTitle: "Resume implementation",
    gates: { specRequired: false, planRequired: false },
    revision: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    phases: [
      {
        kind: "implementation",
        status: "pull-request-open",
        base,
        workspace: {
          runId,
          phase: "implementation",
          identity: { branch: "agent/189", worktreePath: ".worktrees/189" },
          remote: "origin",
          baseBranch: "main",
          baseOid: base.baseOid,
          headOid: implementationOid("b"),
          cleanup: { state: "ready" },
        },
        artifacts: [
          {
            kind: "spec",
            path: "docs/specs/issue-189.md",
            source: "workspace",
            commitOid: implementationOid("b"),
          },
          {
            kind: "plan",
            path: "docs/plans/issue-189.md",
            source: "workspace",
            commitOid: implementationOid("b"),
          },
        ],
        publication: {
          targetRepository: repository,
          headRepository: repository,
          baseBranch: "main",
          headBranch: "agent/189",
          headOid: implementationOid("b"),
        },
        pullRequest: {
          reference: { targetRepository: repository, number: 17 },
          url: "https://github.com/test/repo/pull/17",
        },
        implementation: {
          status: "pr-created",
          prUrl: "https://github.com/test/repo/pull/17",
          branch: "agent/189",
          commits: [implementationOid("b")],
          validation: ["npm test passed"],
          reviewSummary: "No blocking findings",
          visualEvidence: [],
        },
        finish: {},
      },
    ],
  };
}
