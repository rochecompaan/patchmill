import assert from "node:assert/strict";
import { test } from "node:test";
import type { IssueSummary } from "../run-once/types.ts";
import {
  extractPublishedArtifactResult,
  formatPublishedArtifactComment,
} from "./published-artifacts.ts";

function issueWithComments(comments: string[]): IssueSummary {
  return {
    number: 99,
    title: "Log entries UI",
    body: "Issue body",
    labels: ["agent-ready"],
    state: "open",
    comments: comments.map((body) => ({ body })),
  };
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

  const result = extractPublishedArtifactResult(issueWithComments([comment]));

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
    extractPublishedArtifactResult({
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
    content: "# Old",
  });
  const newSpec = formatPublishedArtifactComment({
    kind: "spec",
    path: "docs/specs/new.md",
    content: "# New",
  });
  const plan = formatPublishedArtifactComment({
    kind: "plan",
    path: "docs/plans/work.md",
    content: "# Plan\n\n- [ ] Build",
  });

  const result = extractPublishedArtifactResult(
    issueWithComments([oldSpec, plan, newSpec]),
  );

  assert.equal(result.status, "resolved");
  assert.equal(result.spec?.type, "inline");
  assert.equal(result.spec?.path, "docs/specs/new.md");
  assert.equal(result.spec?.content, "# New");
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
    () => extractPublishedArtifactResult(issueWithComments([comment])),
    /checksum mismatch/,
  );
});

test("extractPublishedArtifactResult returns none when no deterministic artifact is published", () => {
  assert.deepEqual(
    extractPublishedArtifactResult(
      issueWithComments(["Looks like a plan maybe"]),
    ),
    { status: "none" },
  );
});
