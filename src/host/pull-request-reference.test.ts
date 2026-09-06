import assert from "node:assert/strict";
import test from "node:test";
import {
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
