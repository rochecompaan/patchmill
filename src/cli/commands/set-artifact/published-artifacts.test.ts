import assert from "node:assert/strict";
import { test } from "node:test";
import type { IssueSummary } from "../run-once/types.ts";
import {
  extractPublishedArtifactResult,
  formatPublishedArtifactComment,
} from "./published-artifacts.ts";

const TRUSTED_AUTHOR = "patchmill-bot";

function issueWithComments(
  comments: Array<string | { body: string; authorLogin?: string }>,
): IssueSummary {
  return {
    number: 99,
    title: "Log entries UI",
    body: "Issue body",
    labels: ["agent-ready"],
    state: "open",
    comments: comments.map((comment) =>
      typeof comment === "string"
        ? { authorLogin: TRUSTED_AUTHOR, body: comment }
        : comment,
    ),
  };
}

function extractTrusted(issue: IssueSummary) {
  return extractPublishedArtifactResult(issue, {
    trustedAuthors: [TRUSTED_AUTHOR],
  });
}

test("formatPublishedArtifactComment creates a deterministic spec envelope that extracts verbatim", () => {
  const comment = formatPublishedArtifactComment({
    kind: "spec",
    path: "docs/specs/log-entries-ui.md",
    content: "# Log Entries UI\r\n\r\nRender server-driven logs.\n",
  });

  assert.match(comment, /## Spec attached to this issue/);
  assert.match(comment, /<summary>Spec content<\/summary>/);
  assert.match(comment, /patchmill-artifact:v1/);
  assert.match(comment, /sha256/);

  const result = extractTrusted(issueWithComments([comment]));

  assert.equal(result.status, "resolved");
  assert.equal(result.spec?.type, "inline");
  assert.equal(result.spec?.path, "docs/specs/log-entries-ui.md");
  assert.equal(
    result.spec?.content,
    "# Log Entries UI\n\nRender server-driven logs.",
  );
});

test("extractPublishedArtifactResult ignores artifact markers in the issue body", () => {
  const body = formatPublishedArtifactComment({
    kind: "spec",
    path: "docs/specs/body.md",
    content: "# Body Spec",
  });

  assert.deepEqual(
    extractTrusted({
      ...issueWithComments([]),
      body,
    }),
    { status: "none" },
  );
});

test("extractPublishedArtifactResult uses the latest artifact of each kind", () => {
  const oldSpec = formatPublishedArtifactComment({
    kind: "spec",
    path: "docs/specs/old.md",
    content: "# Old Spec",
  });
  const newSpec = formatPublishedArtifactComment({
    kind: "spec",
    path: "docs/specs/new.md",
    content: "# New Spec",
  });
  const plan = formatPublishedArtifactComment({
    kind: "plan",
    path: "docs/plans/work.md",
    content: "# Plan\n\n- [ ] Build",
  });

  const result = extractTrusted(issueWithComments([oldSpec, plan, newSpec]));

  assert.equal(result.status, "resolved");
  assert.equal(result.spec?.type, "inline");
  assert.equal(result.spec?.path, "docs/specs/new.md");
  assert.equal(result.spec?.content, "# New Spec");
  assert.equal(result.plan?.type, "inline");
  assert.equal(result.plan?.path, "docs/plans/work.md");
});

test("extractPublishedArtifactResult rejects artifact content that fails its checksum", () => {
  const comment = formatPublishedArtifactComment({
    kind: "plan",
    path: "docs/plans/work.md",
    content: "# Plan\n\n- [ ] Build",
  }).replace("- [ ] Build", "- [ ] Build something else");

  assert.throws(
    () => extractTrusted(issueWithComments([comment])),
    /checksum mismatch/,
  );
});

test("extractPublishedArtifactResult ignores artifacts from untrusted commenters", () => {
  const trustedComment = formatPublishedArtifactComment({
    kind: "spec",
    path: "docs/specs/trusted.md",
    content: "# Trusted Spec",
  });
  const untrustedComment = formatPublishedArtifactComment({
    kind: "spec",
    path: "docs/specs/untrusted.md",
    content: "# Untrusted Spec",
  });

  const result = extractTrusted(
    issueWithComments([
      trustedComment,
      { authorLogin: "mallory", body: untrustedComment },
    ]),
  );

  assert.equal(result.status, "resolved");
  assert.equal(result.spec?.path, "docs/specs/trusted.md");
});

test("extractPublishedArtifactResult ignores malformed artifacts from untrusted commenters", () => {
  const untrustedComment = [
    "<!-- patchmill-artifact:v1 {not-json} -->",
    "# Untrusted Spec",
    "<!-- /patchmill-artifact -->",
  ].join("\n");

  assert.deepEqual(
    extractTrusted(
      issueWithComments([{ authorLogin: "mallory", body: untrustedComment }]),
    ),
    { status: "none" },
  );
});

test("formatPublishedArtifactComment rejects content that run-once would reject as empty", () => {
  assert.throws(
    () =>
      formatPublishedArtifactComment({
        kind: "spec",
        path: "docs/specs/too-short.md",
        content: "# A",
      }),
    /artifact content is empty/,
  );
});

test("formatPublishedArtifactComment rejects whitespace-flexible artifact marker variants", () => {
  assert.throws(
    () =>
      formatPublishedArtifactComment({
        kind: "plan",
        path: "docs/plans/broken-marker.md",
        content: "# Plan\n\n<!--/patchmill-artifact-->",
      }),
    /artifact content contains Patchmill artifact markers/,
  );
});

test("extractPublishedArtifactResult returns none when no deterministic artifact is published", () => {
  assert.deepEqual(
    extractTrusted(issueWithComments(["Looks like a plan maybe"])),
    { status: "none" },
  );
});
