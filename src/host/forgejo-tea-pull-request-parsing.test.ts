import assert from "node:assert/strict";
import test from "node:test";
import { PullRequestIdentityError } from "./pull-requests.ts";
import {
  normalizeForgejoPullRequest,
  normalizeForgejoRepository,
  parseForgejoRemoteUrl,
  validateForgejoBranchName,
  validateForgejoPullRequestNumber,
  validateForgejoRemoteName,
} from "./forgejo-tea-pull-request-parsing.ts";

const targetPayload = {
  name: "widgets-renamed",
  full_name: "platform/widgets-renamed",
  owner: { login: "platform" },
  html_url: "https://FORGE.EXAMPLE/platform/widgets-renamed",
};
const target = {
  provider: "forgejo-tea" as const,
  host: "forge.example",
  owner: "platform",
  repository: "widgets-renamed",
};
const head = {
  provider: "forgejo-tea" as const,
  host: "forge.example",
  owner: "contributor",
  repository: "widgets",
};

for (const [url, expected] of [
  [
    "https://forge.example/acme/widgets.git",
    {
      host: "forge.example",
      owner: "acme",
      repository: "widgets",
      slug: "acme/widgets",
    },
  ],
  [
    "http://FORGE.EXAMPLE/acme/widgets",
    {
      host: "forge.example",
      owner: "acme",
      repository: "widgets",
      slug: "acme/widgets",
    },
  ],
  [
    "ssh://git@forge.example/acme/widgets.git",
    {
      host: "forge.example",
      owner: "acme",
      repository: "widgets",
      slug: "acme/widgets",
    },
  ],
  [
    "git@forge.example:acme/widgets.git",
    {
      host: "forge.example",
      owner: "acme",
      repository: "widgets",
      slug: "acme/widgets",
    },
  ],
] as const)
  test(`parses ${url}`, () =>
    assert.deepEqual(parseForgejoRemoteUrl(url), expected));

test("does not expose rejected clone URLs", () => {
  for (const url of [
    "/srv/git/acme/widgets.git",
    "file:///srv/git/acme/widgets.git",
    "https://robot:secret@forge.example/acme/widgets.git",
    "https://forge.example/widgets.git",
    "https://forge.example/group/acme/widgets.git",
    "https://forge.example/acme/widgets.git?token=secret",
    "git@forge.example:widgets.git",
    "git@forge.example:group/acme/widgets.git",
  ]) {
    assert.throws(
      () => parseForgejoRemoteUrl(url),
      (error: Error) =>
        !error.message.includes(url) && !JSON.stringify(error).includes(url),
    );
  }
});

test("validates public remote, branch, and number input", () => {
  validateForgejoRemoteName("-publish");
  validateForgejoBranchName("feature/topic");
  validateForgejoPullRequestNumber(1);
  for (const value of ["", " "])
    assert.throws(() => validateForgejoRemoteName(value));
  for (const value of [
    "",
    " owner:topic ",
    "owner:topic",
    "topic..next",
    "-topic",
  ])
    assert.throws(() => validateForgejoBranchName(value));
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])
    assert.throws(() => validateForgejoPullRequestNumber(value));
});

test("normalizes an authoritative repository payload", () => {
  assert.deepEqual(
    normalizeForgejoRepository(targetPayload, {
      operation: "resolve-target-repository",
      expectedHost: "forge.example",
    }),
    target,
  );
  for (const payload of [
    null,
    {},
    { ...targetPayload, name: "other" },
    {
      ...targetPayload,
      html_url: "https://robot:secret@forge.example/platform/widgets-renamed",
    },
  ]) {
    assert.throws(() =>
      normalizeForgejoRepository(payload, {
        operation: "resolve-target-repository",
        expectedHost: "forge.example",
      }),
    );
  }
  assert.throws(
    () =>
      normalizeForgejoRepository(targetPayload, {
        operation: "resolve-target-repository",
        expectedHost: "other.example",
      }),
    PullRequestIdentityError,
  );
});

function pull(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    html_url: "https://forge.example/platform/widgets-renamed/pulls/42",
    body: "Refs #186",
    state: "open",
    merged: false,
    merge_commit_sha: null,
    base: { ref: "main", repo: targetPayload },
    head: {
      ref: "agent/issue-186-adapter",
      sha: "abc123",
      repo: {
        name: "widgets",
        full_name: "contributor/widgets",
        owner: { login: "contributor" },
        html_url: "https://forge.example/contributor/widgets",
      },
    },
    ...overrides,
  };
}
const options = {
  operation: "get-pull-request" as const,
  expectedTargetRepository: target,
  expectedHeadRepository: head,
  expectedNumber: 42,
};
test("normalizes valid state combinations and rejects inconsistent pull payloads", () => {
  assert.equal(normalizeForgejoPullRequest(pull(), options).status, "open");
  assert.deepEqual(
    normalizeForgejoPullRequest(
      pull({ state: "closed", merged: true, merge_commit_sha: "abc" }),
      options,
    ).status,
    "merged",
  );
  assert.equal(
    normalizeForgejoPullRequest(pull({ state: "closed" }), options).status,
    "closed-unmerged",
  );
  for (const payload of [
    pull({ number: 0 }),
    pull({ state: "unknown" }),
    pull({ merged: true }),
    pull({ head: { ref: "", sha: "abc", repo: targetPayload } }),
    pull({ base: { ref: "main" } }),
  ])
    assert.throws(() => normalizeForgejoPullRequest(payload, options));
});
