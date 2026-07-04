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

  const resolved = await validateExtractedArtifactSources({
    issue,
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
