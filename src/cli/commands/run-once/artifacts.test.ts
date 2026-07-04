import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveIssueContentArtifact } from "./artifacts.ts";

async function repo() {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-artifacts-"));
  await mkdir(join(repoRoot, "docs", "specs"), { recursive: true });
  await mkdir(join(repoRoot, "docs", "plans"), { recursive: true });
  return repoRoot;
}

test("resolveIssueContentArtifact finds an approved spec path in the issue body", async () => {
  const repoRoot = await repo();
  await writeFile(
    join(repoRoot, "docs/specs/custom-design.md"),
    "# Spec\n",
    "utf8",
  );

  const result = await resolveIssueContentArtifact({
    repoRoot,
    kind: "spec",
    body: "Approved spec: `docs/specs/custom-design.md`",
    comments: [],
  });

  assert.equal(result?.path, "docs/specs/custom-design.md");
  assert.equal(result?.source, "body");
});

test("resolveIssueContentArtifact prefers the most recent valid comment over the body", async () => {
  const repoRoot = await repo();
  await writeFile(
    join(repoRoot, "docs/plans/body-plan.md"),
    "# Body\n",
    "utf8",
  );
  await writeFile(
    join(repoRoot, "docs/plans/recent-plan.md"),
    "# Recent\n",
    "utf8",
  );

  const result = await resolveIssueContentArtifact({
    repoRoot,
    kind: "plan",
    body: "Approved plan: docs/plans/body-plan.md",
    comments: [
      { body: "Approved plan: docs/plans/recent-plan.md" },
      { body: "Looks good." },
    ],
  });

  assert.equal(result?.path, "docs/plans/recent-plan.md");
  assert.equal(result?.source, "comment");
  assert.equal(result?.commentIndex, 0);
});

test("resolveIssueContentArtifact accepts Markdown links and Patchmill existing-ready comments", async () => {
  const repoRoot = await repo();
  await writeFile(
    join(repoRoot, "docs/plans/custom-plan.md"),
    "# Plan\n",
    "utf8",
  );

  assert.equal(
    (
      await resolveIssueContentArtifact({
        repoRoot,
        kind: "plan",
        body: "Approved plan artifact: [plan](docs/plans/custom-plan.md)",
        comments: [],
      })
    )?.path,
    "docs/plans/custom-plan.md",
  );

  assert.equal(
    (
      await resolveIssueContentArtifact({
        repoRoot,
        kind: "plan",
        body: "Existing plan ready: `docs/plans/custom-plan.md`",
        comments: [],
      })
    )?.path,
    "docs/plans/custom-plan.md",
  );
});

test("resolveIssueContentArtifact keeps spec and plan signals independent", async () => {
  const repoRoot = await repo();
  await writeFile(join(repoRoot, "docs/specs/valid.md"), "# Spec\n", "utf8");

  assert.equal(
    await resolveIssueContentArtifact({
      repoRoot,
      kind: "plan",
      body: [
        "Approved spec: docs/specs/valid.md",
        "Approved plan: https://example.test/plan.md",
      ].join("\n"),
      comments: [],
    }),
    undefined,
  );
});

test("resolveIssueContentArtifact rejects unsafe, missing, directory, URL, and ambiguous references", async () => {
  const repoRoot = await repo();
  await mkdir(join(repoRoot, "docs/plans/dir.md"), { recursive: true });
  await writeFile(join(repoRoot, "docs/specs/valid.md"), "# Spec\n", "utf8");

  for (const body of [
    "Approved spec: https://example.test/docs/specs/valid.md",
    "Approved spec: ../outside.md",
    `Approved spec: ${join(tmpdir(), "outside.md")}`,
    "Approved spec: docs/specs/missing.md",
    "Approved plan: docs/plans/dir.md",
    "Approved artifact: docs/specs/valid.md",
    "Spec draft: docs/specs/valid.md",
  ]) {
    assert.equal(
      await resolveIssueContentArtifact({
        repoRoot,
        kind: "spec",
        body,
        comments: [],
      }),
      undefined,
      body,
    );
  }
});
