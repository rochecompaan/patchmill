import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkflowArtifact } from "./stage-advancement.ts";
import type { IssueSummary } from "./types.ts";

const NOW = new Date("2026-07-04T09:00:00.000Z");

function issue(body: string, comments: string[] = []): IssueSummary {
  return {
    number: 65,
    title: "Resolve artifacts",
    body,
    labels: ["spec-approved", "plan-approved"],
    state: "open",
    author: "rochecompaan",
    updated: "2026-07-04T09:00:00Z",
    comments: comments.map((body) => ({ author: { login: "ana" }, body })),
  };
}

async function repo() {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-stage-"));
  await mkdir(join(repoRoot, "docs", "specs"), { recursive: true });
  await mkdir(join(repoRoot, "docs", "plans"), { recursive: true });
  return repoRoot;
}

test("resolveWorkflowArtifact uses saved state before directory and issue content", async () => {
  const repoRoot = await repo();
  await writeFile(join(repoRoot, "docs/specs/saved.md"), "# Saved\n", "utf8");
  await writeFile(
    join(repoRoot, "docs/specs/content.md"),
    "# Content\n",
    "utf8",
  );

  const result = await resolveWorkflowArtifact({
    repoRoot,
    issue: issue("Approved spec: docs/specs/content.md"),
    artifactKind: "spec",
    artifactDir: join(repoRoot, "docs", "specs"),
    approvedLabel: "spec-approved",
    labels: ["spec-approved"],
    savedPath: "docs/specs/saved.md",
    savedCommit: "abc123",
    savedCreated: true,
    findArtifact: async () => join(repoRoot, "docs/specs/content.md"),
    buildArtifact: () => join(repoRoot, "docs/specs/generated.md"),
    now: NOW,
  });

  assert.equal(result.path, "docs/specs/saved.md");
  assert.equal(result.commit, "abc123");
  assert.equal(result.exists, true);
  assert.equal(result.fromState, true);
  assert.equal(result.created, true);
  assert.equal(result.generated, false);
  assert.equal(result.source, "state");
});

test("resolveWorkflowArtifact uses generated-name discovery before issue content", async () => {
  const repoRoot = await repo();
  await writeFile(
    join(repoRoot, "docs/plans/generated-name.md"),
    "# Found\n",
    "utf8",
  );
  await writeFile(
    join(repoRoot, "docs/plans/content.md"),
    "# Content\n",
    "utf8",
  );

  const result = await resolveWorkflowArtifact({
    repoRoot,
    issue: issue("Approved plan: docs/plans/content.md"),
    artifactKind: "plan",
    artifactDir: join(repoRoot, "docs", "plans"),
    approvedLabel: "plan-approved",
    labels: ["plan-approved"],
    findArtifact: async () => join(repoRoot, "docs/plans/generated-name.md"),
    buildArtifact: () => join(repoRoot, "docs/plans/generated.md"),
    now: NOW,
  });

  assert.equal(result.path, "docs/plans/generated-name.md");
  assert.equal(result.exists, true);
  assert.equal(result.generated, false);
  assert.equal(result.source, "directory");
});

test("resolveWorkflowArtifact uses issue content after state and directory discovery", async () => {
  const repoRoot = await repo();
  const specsDir = join(repoRoot, "docs", "specs");
  await writeFile(join(repoRoot, "docs/specs/custom.md"), "# Spec\n", "utf8");

  const result = await resolveWorkflowArtifact({
    repoRoot,
    issue: issue("Approved spec: docs/specs/custom.md"),
    artifactKind: "spec",
    artifactDir: specsDir,
    approvedLabel: "spec-approved",
    labels: ["spec-approved"],
    findArtifact: async () => undefined,
    buildArtifact: () => join(specsDir, "generated.md"),
    now: NOW,
  });

  assert.equal(result.path, "docs/specs/custom.md");
  assert.equal(result.exists, true);
  assert.equal(result.generated, false);
  assert.equal(result.fromState, false);
  assert.equal(result.source, "issue-content");
});

test("resolveWorkflowArtifact ignores issue content without the approved label", async () => {
  const repoRoot = await repo();
  const specsDir = join(repoRoot, "docs", "specs");
  await writeFile(join(repoRoot, "docs/specs/custom.md"), "# Spec\n", "utf8");

  const result = await resolveWorkflowArtifact({
    repoRoot,
    issue: issue("Approved spec: docs/specs/custom.md"),
    artifactKind: "spec",
    artifactDir: specsDir,
    approvedLabel: "spec-approved",
    labels: [],
    findArtifact: async () => undefined,
    buildArtifact: () => join(specsDir, "generated.md"),
    now: NOW,
  });

  assert.equal(result.path, "docs/specs/generated.md");
  assert.equal(result.exists, false);
  assert.equal(result.generated, true);
  assert.equal(result.source, "generated");
});

test("resolveWorkflowArtifact falls back to generated paths for invalid issue content references", async () => {
  const repoRoot = await repo();
  const plansDir = join(repoRoot, "docs", "plans");

  const result = await resolveWorkflowArtifact({
    repoRoot,
    issue: issue("Approved plan: https://example.test/plan.md"),
    artifactKind: "plan",
    artifactDir: plansDir,
    approvedLabel: "plan-approved",
    labels: ["plan-approved"],
    findArtifact: async () => undefined,
    buildArtifact: () => join(plansDir, "generated.md"),
    now: NOW,
  });

  assert.equal(result.path, "docs/plans/generated.md");
  assert.equal(result.exists, false);
  assert.equal(result.generated, true);
  assert.equal(result.source, "generated");
});
