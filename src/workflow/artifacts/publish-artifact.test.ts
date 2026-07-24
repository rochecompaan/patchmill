import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatPublishedArtifactComment } from "./published-artifacts.ts";
import { publishWorkflowArtifact } from "./publish-artifact.ts";

test("publishWorkflowArtifact reads and publishes a deterministic spec", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-publish-"));
  const artifactDir = join(repoRoot, "docs", "specs");
  const artifactPath = join(artifactDir, "issue-42-design.md");
  const content = "# Issue 42 design\n\nApproved behavior.\n";
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactPath, content, "utf8");
  const comments: Array<{ issueNumber: number; body: string }> = [];

  const result = await publishWorkflowArtifact({
    kind: "spec",
    issueNumber: 42,
    repoRoot,
    artifactPath,
    artifactDir,
    publishComment: async (issueNumber, body) => {
      comments.push({ issueNumber, body });
    },
  });

  assert.deepEqual(result, { path: "docs/specs/issue-42-design.md" });
  assert.deepEqual(comments, [
    {
      issueNumber: 42,
      body: formatPublishedArtifactComment({
        kind: "spec",
        path: "docs/specs/issue-42-design.md",
        content,
      }),
    },
  ]);
});

test("publishWorkflowArtifact rejects a path outside the configured artifact directory", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-publish-"));
  const artifactDir = join(repoRoot, "docs", "specs");
  const artifactPath = join(repoRoot, "README.md");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactPath, "# Repository\n", "utf8");

  await assert.rejects(
    publishWorkflowArtifact({
      kind: "spec",
      issueNumber: 42,
      repoRoot,
      artifactPath,
      artifactDir,
      publishComment: async () => {},
    }),
    /spec path must be inside configured specsDir/,
  );
});
