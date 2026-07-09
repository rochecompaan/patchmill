import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IssueSummary } from "./types.ts";
import {
  ArtifactSourcePreflightError,
  validateExtractedArtifactSources,
} from "./artifact-sources.ts";

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

test("validateExtractedArtifactSources returns empty sources for none", async () => {
  const fixture = await repoFixture();
  const resolved = await validateExtractedArtifactSources({
    issue,
    now: new Date("2026-07-04T12:00:00Z"),
    extraction: { status: "none" },
    ...fixture,
  });

  assert.deepEqual(resolved, {});
});

test("validateExtractedArtifactSources validates existing path sources", async () => {
  const fixture = await repoFixture();
  await writeFile(join(fixture.specsDir, "source.md"), "# Spec\n", "utf8");

  const resolved = await validateExtractedArtifactSources({
    issue,
    now: new Date("2026-07-04T12:00:00Z"),
    extraction: {
      status: "resolved",
      spec: {
        kind: "spec",
        type: "path",
        value: "docs/specs/source.md",
        evidence: "Spec path",
      },
    },
    ...fixture,
  });

  assert.equal(resolved.spec?.sourceType, "path");
  assert.equal(resolved.spec?.path, "docs/specs/source.md");
});

test("validateExtractedArtifactSources rejects missing paths", async () => {
  const fixture = await repoFixture();

  await assert.rejects(
    validateExtractedArtifactSources({
      issue,
      now: new Date("2026-07-04T12:00:00Z"),
      extraction: {
        status: "resolved",
        plan: {
          kind: "plan",
          type: "path",
          value: "docs/plans/missing.md",
          evidence: "Plan path",
        },
      },
      ...fixture,
    }),
    (error: unknown) =>
      error instanceof ArtifactSourcePreflightError &&
      /does not exist/.test(error.message),
  );
});

test("validateExtractedArtifactSources rejects path escapes", async () => {
  const fixture = await repoFixture();
  await writeFile(join(fixture.repoRoot, "outside.md"), "# Outside\n", "utf8");

  await assert.rejects(
    validateExtractedArtifactSources({
      issue,
      now: new Date("2026-07-04T12:00:00Z"),
      extraction: {
        status: "resolved",
        spec: {
          kind: "spec",
          type: "path",
          value: "docs/specs/../../outside.md",
          evidence: "Bad path",
        },
      },
      ...fixture,
    }),
    /outside configured specsDir/,
  );
});

test("validateExtractedArtifactSources assigns deterministic paths to inline sources", async () => {
  const fixture = await repoFixture();
  const issueWithInlinePlan = {
    ...issue,
    comments: [{ body: "# Plan\n- [ ] Build" }],
  };

  const resolved = await validateExtractedArtifactSources({
    issue: issueWithInlinePlan,
    now: new Date("2026-07-04T12:00:00Z"),
    extraction: {
      status: "resolved",
      plan: {
        kind: "plan",
        type: "inline",
        content: "# Plan\n- [ ] Build",
        evidence: "Plan block",
      },
    },
    ...fixture,
  });

  assert.equal(
    resolved.plan?.path,
    "docs/plans/2026-07-04-issue-65-resolve-provided-artifacts.md",
  );
  assert.match(resolved.plan?.content ?? "", /Build/);
});

test("validateExtractedArtifactSources preserves inline source paths inside artifact directories", async () => {
  const fixture = await repoFixture();
  const issueWithInlineSpec = {
    ...issue,
    comments: [{ body: "# Spec\n\nUse the provided path." }],
  };

  const resolved = await validateExtractedArtifactSources({
    issue: issueWithInlineSpec,
    now: new Date("2026-07-04T12:00:00Z"),
    extraction: {
      status: "resolved",
      spec: {
        kind: "spec",
        type: "inline",
        path: "docs/specs/custom.md",
        content: "# Spec\n\nUse the provided path.",
        evidence: "Published spec block",
      },
    },
    ...fixture,
  });

  assert.equal(resolved.spec?.path, "docs/specs/custom.md");
});

test("validateExtractedArtifactSources rejects inline summaries that are not verbatim issue content", async () => {
  const fixture = await repoFixture();

  await assert.rejects(
    validateExtractedArtifactSources({
      issue,
      now: new Date("2026-07-04T12:00:00Z"),
      extraction: {
        status: "resolved",
        spec: {
          kind: "spec",
          type: "inline",
          content: "# Summary\n\nThis was paraphrased by a model.",
          evidence: "Spec-ish block",
        },
      },
      ...fixture,
    }),
    /not copied verbatim/,
  );
});

test("validateExtractedArtifactSources rejects inline source paths outside artifact directories", async () => {
  const fixture = await repoFixture();
  const issueWithInlineSpec = {
    ...issue,
    comments: [{ body: "# Spec\n\nUse the provided path." }],
  };

  await assert.rejects(
    validateExtractedArtifactSources({
      issue: issueWithInlineSpec,
      now: new Date("2026-07-04T12:00:00Z"),
      extraction: {
        status: "resolved",
        spec: {
          kind: "spec",
          type: "inline",
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

test("validateExtractedArtifactSources rejects ambiguous extraction", async () => {
  const fixture = await repoFixture();

  await assert.rejects(
    validateExtractedArtifactSources({
      issue,
      now: new Date("2026-07-04T12:00:00Z"),
      extraction: { status: "ambiguous", reason: "Two plan sections" },
      ...fixture,
    }),
    /ambiguous artifact sources: Two plan sections/,
  );
});
