import assert from "node:assert/strict";
import test from "node:test";
import {
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
