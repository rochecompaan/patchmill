import assert from "node:assert/strict";
import test from "node:test";
import { renderPlanningPullRequestMarker } from "./planning-pull-request-markers.ts";
import {
  assertPlanningPublicationRepositories,
  PlanningPullRequestValidationError,
  validatePlanningPullRequestSummary,
} from "./planning-pull-request-validation.ts";

const repository = {
  provider: "github-gh" as const,
  host: "github.com",
  owner: "acme",
  repository: "patchmill",
};
const publication = {
  targetRepository: repository,
  headRepository: repository,
  baseBranch: "main",
  headBranch: "planning/spec",
  headOid: "a".repeat(40),
};
const summary = {
  number: 188,
  url: "https://github.com/acme/patchmill/pull/188",
  targetRepository: repository,
  baseBranch: "main",
  headRepository: repository,
  headBranch: "planning/spec",
  headSha: "a".repeat(40),
  body: `Human text\n\n${renderPlanningPullRequestMarker({ issueNumber: 188, phase: "spec" })}`,
  status: "open" as const,
};
test("accepts exactly matching owned planning pull requests", () => {
  assert.deepEqual(
    validatePlanningPullRequestSummary({
      summary,
      issueNumber: 188,
      phase: "spec",
      publication,
    }).reference.number,
    188,
  );
});
test("rejects a marker mismatch without disclosing the body", () => {
  const secret = "https://token@example.test/private";
  assert.throws(
    () =>
      validatePlanningPullRequestSummary({
        summary: {
          ...summary,
          body: `${secret}\n${renderPlanningPullRequestMarker({ issueNumber: 187, phase: "spec" })}`,
        },
        issueNumber: 188,
        phase: "spec",
        publication,
      }),
    (error: unknown) =>
      error instanceof PlanningPullRequestValidationError &&
      !error.message.includes(secret) &&
      error.reason === "ownership-marker",
  );
});
test("permits same-host Forgejo heads and rejects cross-host heads", () => {
  assert.doesNotThrow(() =>
    assertPlanningPublicationRepositories({
      targetRepository: {
        provider: "forgejo-tea",
        host: "forge.test",
        owner: "one",
        repository: "source",
      },
      headRepository: {
        provider: "forgejo-tea",
        host: "FORGE.TEST",
        owner: "two",
        repository: "fork",
      },
    }),
  );
  assert.throws(
    () =>
      assertPlanningPublicationRepositories({
        targetRepository: {
          provider: "forgejo-tea",
          host: "forge.test",
          owner: "one",
          repository: "source",
        },
        headRepository: {
          provider: "forgejo-tea",
          host: "other.test",
          owner: "two",
          repository: "fork",
        },
      }),
    /forgejo-host-mismatch/,
  );
});
