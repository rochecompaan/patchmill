import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolvePlanningArtifacts,
  type PlanningArtifactPolicy,
} from "./planning-artifacts.ts";
import type { IssueSummary } from "./types.ts";

const NOW = new Date("2026-05-09T12:00:00.000Z");

function issue(number: number): IssueSummary {
  return {
    number,
    title: "Recover blocked run",
    body: "Body",
    labels: ["needs-info"],
    state: "open",
    author: "tester",
    updated: "2026-05-09T11:00:00Z",
    comments: [],
  };
}

async function repoFixture(): Promise<{
  repoRoot: string;
  worktreeRoot: string;
  policy: PlanningArtifactPolicy;
}> {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-artifacts-"));
  const worktreeRoot = join(repoRoot, ".worktrees", "patchmill-issue-45");
  await mkdir(join(worktreeRoot, "docs", "plans"), { recursive: true });
  await mkdir(join(worktreeRoot, "docs", "specs"), { recursive: true });
  await writeFile(
    join(worktreeRoot, "docs/plans/saved-plan.md"),
    "# Saved plan\n",
    "utf8",
  );
  await writeFile(
    join(worktreeRoot, "docs/specs/saved-spec.md"),
    "# Saved spec\n",
    "utf8",
  );
  return {
    repoRoot,
    worktreeRoot,
    policy: {
      kind: "implementation-resume",
      primary: {
        repoRoot: worktreeRoot,
        specsDir: join(worktreeRoot, "docs", "specs"),
        plansDir: join(worktreeRoot, "docs", "plans"),
        source: "resume-worktree",
      },
      fallbacks: [
        {
          repoRoot,
          specsDir: join(repoRoot, "docs", "specs"),
          plansDir: join(repoRoot, "docs", "plans"),
          source: "primary-repo",
        },
      ],
      saved: {
        specPath: "docs/specs/saved-spec.md",
        specCommit: "spec123",
        planPath: "docs/plans/saved-plan.md",
        planCommit: "plan123",
      },
    },
  };
}

test("implementation resume uses saved artifacts before explicit comments", async () => {
  const { policy } = await repoFixture();

  const artifacts = await resolvePlanningArtifacts({
    policy: {
      ...policy,
      explicit: {
        plan: {
          path: "docs/plans/saved-plan.md",
          commit: "plan123",
        },
      },
    },
    issue: issue(45),
    now: NOW,
  });

  assert.equal(artifacts.plan.path, "docs/plans/saved-plan.md");
  assert.equal(artifacts.plan.fromState, true);
});

test("implementation resume rejects mismatched explicit artifact comments", async () => {
  const { policy } = await repoFixture();

  await assert.rejects(
    () =>
      resolvePlanningArtifacts({
        policy: {
          ...policy,
          explicit: {
            plan: {
              path: "docs/plans/unrelated-plan.md",
              commit: "other123",
            },
          },
        },
        issue: issue(45),
        now: NOW,
      }),
    /Explicit plan artifact docs\/plans\/unrelated-plan\.md does not match saved plan docs\/plans\/saved-plan\.md/,
  );
});

test("fresh policy accepts explicit artifact comments before discovery", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-artifacts-"));
  const artifacts = await resolvePlanningArtifacts({
    policy: {
      kind: "fresh",
      primary: {
        repoRoot,
        specsDir: join(repoRoot, "docs", "specs"),
        plansDir: join(repoRoot, "docs", "plans"),
        source: "primary-repo",
      },
      explicit: {
        spec: { path: "docs/specs/published-spec.md", commit: "specpub" },
        plan: { path: "docs/plans/published-plan.md", commit: "planpub" },
      },
      allowGeneratedSpec: true,
      allowGeneratedPlan: true,
    },
    issue: issue(65),
    now: NOW,
  });

  assert.equal(artifacts.spec.path, "docs/specs/published-spec.md");
  assert.equal(artifacts.spec.commit, "specpub");
  assert.equal(artifacts.plan.path, "docs/plans/published-plan.md");
  assert.equal(artifacts.plan.commit, "planpub");
});
