import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeArtifactExtractionResults } from "./artifact-source-stage.ts";
import type { ArtifactExtractionResult } from "./artifact-source-extraction.ts";

test("mergeArtifactExtractionResults keeps deterministic artifacts and fills missing kinds from Pi", () => {
  const published: ArtifactExtractionResult = {
    status: "resolved",
    spec: {
      kind: "spec",
      type: "inline",
      path: "docs/specs/published.md",
      content: "# Published Spec",
      evidence: "published spec",
    },
  };
  const pi: ArtifactExtractionResult = {
    status: "resolved",
    spec: {
      kind: "spec",
      type: "inline",
      content: "# Model Spec",
      evidence: "model spec",
    },
    plan: {
      kind: "plan",
      type: "path",
      value: "docs/plans/existing.md",
      evidence: "existing plan path",
    },
  };

  assert.deepEqual(mergeArtifactExtractionResults(published, pi), {
    status: "resolved",
    spec: {
      kind: "spec",
      type: "inline",
      path: "docs/specs/published.md",
      content: "# Published Spec",
      evidence: "published spec",
    },
    plan: {
      kind: "plan",
      type: "path",
      value: "docs/plans/existing.md",
      evidence: "existing plan path",
    },
  });
});

test("mergeArtifactExtractionResults preserves a complete deterministic result when Pi finds none", () => {
  const published: ArtifactExtractionResult = {
    status: "resolved",
    spec: {
      kind: "spec",
      type: "inline",
      path: "docs/specs/published.md",
      content: "# Published Spec",
      evidence: "published spec",
    },
    plan: {
      kind: "plan",
      type: "inline",
      path: "docs/plans/published.md",
      content: "# Published Plan",
      evidence: "published plan",
    },
  };

  assert.equal(
    mergeArtifactExtractionResults(published, { status: "none" }),
    published,
  );
});
