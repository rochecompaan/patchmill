import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCanonicalPullRequestUrl,
  parsePullRequestUrl,
  pullRequestNumber,
  sameCanonicalUrl,
} from "./pull-request-reference.ts";

test("pullRequestNumber accepts only the requested provider pull path", () => {
  assert.equal(
    pullRequestNumber("https://github.com/acme/repo/pull/42", "pull"),
    42,
  );
  assert.equal(
    pullRequestNumber("https://forge.example/acme/repo/pulls/43", "pulls"),
    43,
  );
  assert.throws(
    () => pullRequestNumber("https://github.com/acme/repo/pulls/42", "pull"),
    /Invalid pull request URL/u,
  );
});

test("parsePullRequestUrl exposes canonical URL parts without accepting unsafe forms", () => {
  assert.deepEqual(
    parsePullRequestUrl("https://github.com/acme/repo/pull/42/", "pull"),
    {
      protocol: "https:",
      hostname: "github.com",
      port: "",
      owner: "acme",
      repository: "repo",
      number: 42,
      hasTrailingSlash: true,
    },
  );
  assert.throws(
    () =>
      parsePullRequestUrl(
        "https://user:secret@github.com/acme/repo/pull/42",
        "pull",
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /user|secret/u);
      return true;
    },
  );
  for (const value of [
    "ftp://github.com/acme/repo/pull/42",
    "https://github.com/acme/repo/pull/0",
    "https://github.com/acme/repo/pull/42?x=y",
    "https://github.com/acme/repo/pull/42#fragment",
    "file:///acme/repo/pull/42",
    "https://github.com/acme//repo/pull/42",
    "https://github.com/acme/repo/pull/42/extra",
    "https://github.com/acme/repo/pull/9007199254740992",
  ])
    assert.throws(() => parsePullRequestUrl(value, "pull"));
});

test("parseCanonicalPullRequestUrl normalizes default ports and preserves Forgejo ports", () => {
  const github = {
    provider: "github-gh" as const,
    host: "github.com",
    owner: "acme",
    repository: "repo",
  };
  assert.deepEqual(
    parseCanonicalPullRequestUrl(
      "https://GITHUB.COM:443/Acme/Repo/pull/42/",
      github,
    ),
    {
      reference: { targetRepository: github, number: 42 },
      url: "https://github.com/acme/repo/pull/42",
    },
  );
  const forgejo = {
    provider: "forgejo-tea" as const,
    host: "forge.example:8443",
    owner: "acme",
    repository: "repo",
  };
  assert.equal(
    parseCanonicalPullRequestUrl(
      "https://FORGE.EXAMPLE:8443/Acme/Repo/pulls/42/",
      forgejo,
    )?.url,
    "https://forge.example:8443/acme/repo/pulls/42",
  );
  assert.equal(
    parseCanonicalPullRequestUrl(
      "https://github.com/acme/repo/pulls/42",
      github,
    ),
    undefined,
  );
  assert.equal(
    parseCanonicalPullRequestUrl(
      "https://github.com/other/repo/pull/42",
      github,
    ),
    undefined,
  );
  assert.equal(
    parseCanonicalPullRequestUrl("https://github.com/acme/repo/pull/43", github)
      ?.reference.number,
    43,
  );
});

test("sameCanonicalUrl accepts canonical case-only repository URLs", () => {
  assert.equal(
    sameCanonicalUrl(
      "https://github.com/acme/repo/pull/42",
      "https://GITHUB.COM/Acme/Repo/pull/42/",
    ),
    true,
  );
  assert.equal(
    sameCanonicalUrl(
      "https://forge.example:8443/acme/repo/pulls/42",
      "https://FORGE.EXAMPLE:8443/Acme/Repo/pulls/42/",
    ),
    true,
  );
});

test("sameCanonicalUrl rejects a different repository but permits one trailing slash", () => {
  assert.equal(
    sameCanonicalUrl(
      "https://github.com/acme/repo/pull/42",
      "https://github.com/acme/repo/pull/42/",
    ),
    true,
  );
  assert.equal(
    sameCanonicalUrl(
      "https://github.com/acme/repo/pull/42",
      "https://github.com/other/repo/pull/42",
    ),
    false,
  );
});
