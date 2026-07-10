import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IssueSummary } from "./types.ts";
import { validateIssueArtifactSources } from "./artifact-sources.ts";

const issue: IssueSummary = {
  number: 65,
  title: "Resolve provided artifacts",
  body: "Body",
  labels: ["agent-ready"],
  state: "open",
};

async function repoFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-artifacts-"));
  const specsDir = join(repoRoot, "docs", "specs");
  const plansDir = join(repoRoot, "docs", "plans");
  await mkdir(specsDir, { recursive: true });
  await mkdir(plansDir, { recursive: true });
  return { repoRoot, specsDir, plansDir };
}

test("validateIssueArtifactSources returns empty sources for no artifacts", async () => {
  const fixture = await repoFixture();
  const resolved = await validateIssueArtifactSources({
    issue,
    artifacts: {},
    ...fixture,
  });

  assert.deepEqual(resolved, {});
});

test("validateIssueArtifactSources preserves artifact paths inside artifact directories", async () => {
  const fixture = await repoFixture();
  const issueWithSpec = {
    ...issue,
    comments: [{ body: "# Spec\n\nUse the provided path." }],
  };

  const resolved = await validateIssueArtifactSources({
    issue: issueWithSpec,
    artifacts: {
      spec: {
        path: "docs/specs/custom.md",
        content: "# Spec\n\nUse the provided path.",
        evidence: "Published spec block",
      },
    },
    ...fixture,
  });

  assert.equal(resolved.spec?.path, "docs/specs/custom.md");
  assert.equal(resolved.spec?.content, "# Spec\n\nUse the provided path.");
});

test("validateIssueArtifactSources rejects artifact summaries that are not verbatim issue content", async () => {
  const fixture = await repoFixture();

  await assert.rejects(
    validateIssueArtifactSources({
      issue,
      artifacts: {
        spec: {
          path: "docs/specs/summary.md",
          content: "# Summary\n\nThis was paraphrased by a model.",
          evidence: "Spec-ish block",
        },
      },
      ...fixture,
    }),
    /not copied verbatim/,
  );
});

test("validateIssueArtifactSources rejects artifact paths outside artifact directories", async () => {
  const fixture = await repoFixture();
  const issueWithSpec = {
    ...issue,
    comments: [{ body: "# Spec\n\nUse the provided path." }],
  };

  await assert.rejects(
    validateIssueArtifactSources({
      issue: issueWithSpec,
      artifacts: {
        spec: {
          path: "docs/specs/../../outside.md",
          content: "# Spec\n\nUse the provided path.",
          evidence: "Bad path",
        },
      },
      ...fixture,
    }),
    /outside configured specsDir/,
  );
});
