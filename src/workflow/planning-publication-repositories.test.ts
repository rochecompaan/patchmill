import assert from "node:assert/strict";
import test from "node:test";
import { sameRepositoryIdentity } from "../host/pull-requests.ts";
import {
  PlanningStateValidationError,
  validatePlanningState,
} from "./planning-state.ts";
import {
  PlanningPublicationRepositoryError,
  assertPlanningPublicationRepositories,
} from "./planning-publication-repositories.ts";
import {
  assertPlanningPublicationRepositories as assertPullRequestPublicationRepositories,
  PlanningPullRequestValidationError,
  validatePlanningPullRequestSummary,
} from "./planning-pull-request-validation.ts";
import { renderPlanningPullRequestMarker } from "./planning-pull-request-markers.ts";

const oid = "b".repeat(40);
const baseOid = "a".repeat(40);
const github = {
  provider: "github-gh" as const,
  host: "github.com",
  owner: "Acme",
  repository: "Patchmill",
};
const forgejo = {
  provider: "forgejo-tea" as const,
  host: "forge.test",
  owner: "Acme",
  repository: "Patchmill",
};

test("uses one case-insensitive repository identity comparison", () => {
  assert.equal(
    sameRepositoryIdentity(github, {
      ...github,
      host: "GITHUB.COM",
      owner: "acme",
      repository: "patchmill",
    }),
    true,
  );
});

test("pull request validation maps the shared policy failure to its typed error", () => {
  assert.throws(
    () =>
      assertPullRequestPublicationRepositories({
        targetRepository: github,
        headRepository: { ...github, repository: "fork" },
      }),
    (error: unknown) =>
      error instanceof PlanningPullRequestValidationError &&
      error.reason === "github-head-mismatch",
  );
});

test("state parsing and pull request validation agree on publication repositories", () => {
  for (const [name, targetRepository, headRepository, allowed] of [
    ["github same", github, { ...github, owner: "acme" }, true],
    ["github fork", github, { ...github, repository: "fork" }, false],
    ["forgejo same host", forgejo, { ...forgejo, owner: "fork" }, true],
    ["forgejo host", forgejo, { ...forgejo, host: "other.test" }, false],
    ["provider", github, forgejo, false],
  ] as const) {
    const publication = {
      targetRepository,
      headRepository,
      baseBranch: "main",
      headBranch: "planning/spec",
      headOid: oid,
    };
    const summary = {
      number: 188,
      url: `https://${targetRepository.host}/${targetRepository.owner}/${targetRepository.repository}/${targetRepository.provider === "github-gh" ? "pull" : "pulls"}/188`,
      targetRepository,
      baseBranch: "main",
      headRepository,
      headBranch: "planning/spec",
      headSha: oid,
      body: renderPlanningPullRequestMarker({
        issueNumber: 188,
        phase: "spec",
      }),
      status: "open" as const,
    };
    const document = {
      version: 1,
      workflowVersion: "planning-pr-v1",
      runId: "123e4567-e89b-42d3-a456-426614174000",
      issueNumber: 188,
      issueTitle: "Example",
      gates: { specRequired: true, planRequired: false },
      phases: [
        {
          kind: "spec",
          status: "branch-pushed",
          base: {
            remote: "origin",
            baseBranch: "main",
            baseOid,
            artifactCandidates: { spec: ["docs/specs/a.md"], plan: [] },
          },
          workspace: {
            runId: "123e4567-e89b-42d3-a456-426614174000",
            phase: "spec",
            identity: {
              branch: "planning/spec",
              worktreePath: ".worktrees/spec",
            },
            remote: "origin",
            baseBranch: "main",
            baseOid,
            headOid: oid,
            cleanup: { state: "ready" },
          },
          artifacts: [
            {
              kind: "spec",
              path: "docs/specs/a.md",
              commitOid: oid,
              source: "workspace",
            },
          ],
          publication,
        },
        { kind: "implementation", status: "pending" },
      ],
      revision: 0,
      createdAt: "2026-09-08T12:00:00.000Z",
      updatedAt: "2026-09-08T12:00:00.000Z",
    };
    const attempts = [
      () => assertPlanningPublicationRepositories(publication),
      () => validatePlanningState(document),
      () =>
        validatePlanningPullRequestSummary({
          summary,
          issueNumber: 188,
          phase: "spec",
          publication,
        }),
    ];
    for (const attempt of attempts) {
      if (allowed) assert.doesNotThrow(attempt, name);
      else
        assert.throws(
          attempt,
          (error: unknown) =>
            error instanceof PlanningPublicationRepositoryError ||
            error instanceof PlanningStateValidationError ||
            error instanceof PlanningPullRequestValidationError,
          name,
        );
    }
  }
});
