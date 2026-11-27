import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GITHUB_PULL_REQUEST_BODY_LIMIT,
  renderReleaseNotesWithinLimit,
} from "./pull-request-release-notes.mjs";

const releases = ["1.0.0", "1.1.0"].map((version) => ({ version }));
const renderFull = (release) => `full ${release.version}`;
const renderLink = (release) => `link ${release.version}`;

test("all full release notes are kept when they fit", () => {
  const body = renderReleaseNotesWithinLimit({
    label: "Example",
    releases,
    renderFull,
    renderLink,
    renderBody: ({ sections, notice }) =>
      [notice ?? "no notice", ...sections].join("\n"),
  });

  assert.equal(body, "no notice\nfull 1.0.0\nfull 1.1.0");
});

test("the body is rejected when it exceeds the limit with every release linked", () => {
  assert.throws(
    () =>
      renderReleaseNotesWithinLimit({
        label: "Example",
        releases,
        renderFull,
        renderLink,
        renderBody: ({ sections }) =>
          "x".repeat(GITHUB_PULL_REQUEST_BODY_LIMIT) + sections.join(""),
      }),
    /Example pull-request body exceeds GitHub's 65,536-character limit/,
  );
});
