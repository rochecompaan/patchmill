import assert from "node:assert/strict";
import test from "node:test";
import { ForgejoTeaPullRequestError } from "./forgejo-tea-pull-request-errors.ts";
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
  [
    "forge.example:acme/widgets.git",
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
    "https://forge.example/acme\\widgets.git",
    "https://forge.example/acme/widgets%",
    "git@forge.example:acme/widgets.git?token=secret",
    "git@forge.example:acme\\widgets.git",
    "git@forge.example:acme/widgets%",
    "git@forge.example:acme/widgets.git#fragment",
    "git@forge.example:widgets.git",
    "git@forge.example:group/acme/widgets.git",
    "git@forge.example:/acme/widgets.git",
    "git@forge.example:acme/widgets.git/",
    "https://forge.example/acme//widgets.git",
    "https://forge.example/acme/widgets.git/",
    "ssh:///acme/widgets.git",
    "https://forge.example/ignored/../acme/widgets.git",
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
    "topic\u007fnext",
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
  assert.deepEqual(normalizeForgejoPullRequest(pull(), options), {
    number: 42,
    url: "https://forge.example/platform/widgets-renamed/pulls/42",
    targetRepository: target,
    baseBranch: "main",
    headRepository: head,
    headBranch: "agent/issue-186-adapter",
    headSha: "abc123",
    body: "Refs #186",
    status: "open",
  });
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

test("rejects malformed repository and pull-request response fields by category", () => {
  const malformedRepositoryPayloads = [
    null,
    {},
    { ...targetPayload, name: null },
    { ...targetPayload, name: "" },
    { ...targetPayload, full_name: null },
    { ...targetPayload, full_name: "platform//widgets-renamed" },
    { ...targetPayload, owner: null },
    { ...targetPayload, owner: { login: 1 } },
    { ...targetPayload, owner: { login: "" } },
    { ...targetPayload, html_url: null },
    {
      ...targetPayload,
      html_url: "ssh://forge.example/platform/widgets-renamed",
    },
    {
      ...targetPayload,
      html_url: "https://robot:secret@forge.example/platform/widgets-renamed",
    },
    {
      ...targetPayload,
      html_url: "https://forge.example/platform/widgets-renamed?token=secret",
    },
    {
      ...targetPayload,
      html_url: "https://forge.example/platform//widgets-renamed",
    },
    {
      ...targetPayload,
      html_url: "https://forge.example/platform/widgets-renamed/",
    },
    {
      ...targetPayload,
      html_url: "https://forge.example/ignored/../platform/widgets-renamed",
    },
    {
      ...targetPayload,
      html_url: "https://forge.example/platform\\widgets-renamed",
    },
    {
      ...targetPayload,
      html_url: "https://forge.example/platform/widgets-renamed%",
    },
  ];
  for (const payload of malformedRepositoryPayloads)
    assert.throws(
      () =>
        normalizeForgejoRepository(payload, {
          operation: "resolve-target-repository",
        }),
      (error: unknown) =>
        error instanceof ForgejoTeaPullRequestError &&
        error.category === "malformed-response",
    );

  for (const payload of [
    pull({ number: Number.MAX_SAFE_INTEGER + 1 }),
    pull({ body: null }),
    pull({ base: null }),
    pull({ base: { ref: "", repo: targetPayload } }),
    pull({ head: null }),
    pull({ head: { ref: "topic", sha: "", repo: targetPayload } }),
    pull({
      html_url: "https://forge.example/platform//widgets-renamed/pulls/42",
    }),
    pull({
      html_url: "https://forge.example/platform/widgets-renamed/pulls/42/",
    }),
    pull({
      html_url:
        "https://forge.example/ignored/../platform/widgets-renamed/pulls/42",
    }),
    pull({
      html_url: "https://forge.example/platform\\widgets-renamed/pulls/42",
    }),
    pull({
      html_url: "https://forge.example/platform/widgets-renamed/pulls/42%",
    }),
    pull({
      html_url: "https://forge.example/platform/widgets-renamed/issues/42",
    }),
    pull({
      html_url: "https://forge.example/platform/widgets-renamed/pulls/41",
    }),
    pull({ state: "open", merged: false, merge_commit_sha: "abc" }),
    pull({ state: "open", merged: false, merge_commit_sha: undefined }),
    pull({ state: "open", merged: true, merge_commit_sha: null }),
    pull({ state: "open", merged: true, merge_commit_sha: "abc" }),
    pull({ state: "closed", merged: true, merge_commit_sha: null }),
    pull({ state: "closed", merged: true, merge_commit_sha: " " }),
    pull({ state: "closed", merged: false, merge_commit_sha: "abc" }),
    pull({ state: "closed", merged: false, merge_commit_sha: " " }),
    pull({ state: "closed", merged: false, merge_commit_sha: undefined }),
  ])
    assert.throws(
      () => normalizeForgejoPullRequest(payload, options),
      (error: unknown) =>
        error instanceof ForgejoTeaPullRequestError &&
        error.category === "malformed-response",
    );
});

test("uses identity errors only for complete identity disagreements", () => {
  assert.throws(
    () =>
      normalizeForgejoRepository(
        { ...targetPayload, name: "other" },
        { operation: "resolve-target-repository" },
      ),
    PullRequestIdentityError,
  );
  for (const payload of [
    pull({
      html_url: "https://other.example/platform/widgets-renamed/pulls/42",
    }),
    pull({
      head: {
        ref: "agent/issue-186-adapter",
        sha: "abc123",
        repo: targetPayload,
      },
    }),
  ])
    assert.throws(
      () => normalizeForgejoPullRequest(payload, options),
      PullRequestIdentityError,
    );
  const sameOwner = pull({
    head: {
      ref: "topic",
      sha: "abc",
      repo: repositoryPayload(target),
    },
  });
  assert.equal(
    normalizeForgejoPullRequest(sameOwner, {
      operation: "list-pull-requests",
      expectedTargetRepository: target,
    }).headRepository.owner,
    "platform",
  );
});

function repositoryPayload(identity: typeof target) {
  return {
    name: identity.repository,
    full_name: `${identity.owner}/${identity.repository}`,
    owner: { login: identity.owner },
    html_url: `https://${identity.host}/${identity.owner}/${identity.repository}`,
  };
}
