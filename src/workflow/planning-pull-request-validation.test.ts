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
test("accepts a port-qualified Forgejo pull request URL", () => {
  const forgejo = {
    provider: "forgejo-tea" as const,
    host: "forge.test:3000",
    owner: "acme",
    repository: "patchmill",
  };
  assert.doesNotThrow(() =>
    validatePlanningPullRequestSummary({
      summary: {
        ...summary,
        url: "https://forge.test:3000/acme/patchmill/pulls/188",
        targetRepository: forgejo,
        headRepository: forgejo,
      },
      issueNumber: 188,
      phase: "spec",
      publication: {
        ...publication,
        targetRepository: forgejo,
        headRepository: forgejo,
      },
    }),
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

test("rejects every immutable pull request summary identity mutation", () => {
  const mutations: Array<[string, (value: Record<string, unknown>) => void]> = [
    [
      "target repository",
      (value) => {
        value.targetRepository = { ...repository, repository: "other" };
      },
    ],
    [
      "head repository",
      (value) => {
        value.headRepository = { ...repository, repository: "other" };
      },
    ],
    [
      "base branch",
      (value) => {
        value.baseBranch = "other";
      },
    ],
    [
      "head branch",
      (value) => {
        value.headBranch = "planning/other";
      },
    ],
    [
      "head oid",
      (value) => {
        value.headSha = "b".repeat(40);
      },
    ],
    [
      "url",
      (value) => {
        value.url = "https://github.com/acme/other/pull/188";
      },
    ],
  ];
  for (const [name, mutate] of mutations) {
    const value = structuredClone(summary) as Record<string, unknown>;
    mutate(value);
    assert.throws(
      () =>
        validatePlanningPullRequestSummary({
          summary: value as never,
          issueNumber: 188,
          phase: "spec",
          publication,
        }),
      PlanningPullRequestValidationError,
      name,
    );
  }
});

test("rejects missing duplicate and unsupported markers without leaking body sentinels", () => {
  const secret = "credential-sentinel-should-never-escape";
  const bodies = [
    secret,
    `${secret}\n${renderPlanningPullRequestMarker({ issueNumber: 188, phase: "spec" })}\n${renderPlanningPullRequestMarker({ issueNumber: 188, phase: "spec" })}`,
    `${secret}\n<!-- patchmill:planning-pr-v2 issue=188 phase=spec -->`,
  ];
  for (const body of bodies) {
    try {
      validatePlanningPullRequestSummary({
        summary: { ...summary, body },
        issueNumber: 188,
        phase: "spec",
        publication,
      });
      assert.fail("expected validation failure");
    } catch (error) {
      assert.ok(error instanceof PlanningPullRequestValidationError);
      assert.equal(error.message.includes(secret), false);
      assert.equal(JSON.stringify(error).includes(secret), false);
      assert.equal(
        Object.values(error).some((value) => String(value).includes(secret)),
        false,
      );
    }
  }
});

test("rejects expected-reference and URL shape mismatches without exposing confidential bodies", () => {
  const secret = "private-body-sentinel";
  const expectedReference = { targetRepository: repository, number: 189 };
  const cases = [
    { name: "reference", summary, expectedReference },
    {
      name: "url number",
      summary: {
        ...summary,
        url: "https://github.com/acme/patchmill/pull/189",
      },
    },
    {
      name: "provider segment",
      summary: {
        ...summary,
        url: "https://github.com/acme/patchmill/pulls/188",
      },
    },
    {
      name: "credential URL",
      summary: {
        ...summary,
        url: "https://token@example.com/acme/patchmill/pull/188",
        body: secret,
      },
    },
    {
      name: "phase marker",
      summary: {
        ...summary,
        body: `${secret}\n${renderPlanningPullRequestMarker({ issueNumber: 188, phase: "plan" })}`,
      },
    },
  ];
  for (const item of cases) {
    assert.throws(
      () =>
        validatePlanningPullRequestSummary({
          summary: item.summary,
          issueNumber: 188,
          phase: "spec",
          publication,
          ...(item.expectedReference === undefined
            ? {}
            : { expectedReference: item.expectedReference }),
        }),
      (error: unknown) =>
        error instanceof PlanningPullRequestValidationError &&
        !error.message.includes(secret) &&
        !JSON.stringify(error).includes(secret),
      item.name,
    );
  }
});

test("accepts implementation ownership identity without changing status semantics", () => {
  assert.doesNotThrow(() =>
    validatePlanningPullRequestSummary({
      summary: {
        ...summary,
        body: `Summary\n\n${renderPlanningPullRequestMarker({ issueNumber: 188, phase: "implementation" })}`,
      },
      issueNumber: 188,
      phase: "implementation",
      publication,
    }),
  );
});
