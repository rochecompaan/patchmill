import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import {
  assertApprovedArtifactsResolvable,
  type ApprovedArtifactPreflightOptions,
} from "./approval-artifact-preflight.ts";
import type { ResolvedIssueArtifactSource } from "./artifact-sources.ts";
import type { IssueSummary } from "./types.ts";

const now = new Date("2026-08-02T12:00:00Z");

async function fixture() {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-approval-preflight-"),
  );
  const approvalPolicy = createWorkflowApprovalPolicy({
    ...DEFAULT_PATCHMILL_CONFIG.workflow,
    specApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.specApproval,
      required: true,
    },
    planApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.planApproval,
      required: true,
    },
  });
  const config: ApprovedArtifactPreflightOptions["config"] = {
    repoRoot,
    specsDir: join(repoRoot, "docs", "specs"),
    plansDir: join(repoRoot, "docs", "plans"),
    approvalPolicy,
  };
  const issue: IssueSummary = {
    number: 140,
    title: "Keep approved artifacts",
    body: "Approved workflow artifacts",
    labels: [],
    state: "open",
    comments: [],
  };
  return { config, issue };
}

function source(
  repoRoot: string,
  kind: "spec" | "plan",
): ResolvedIssueArtifactSource {
  const path =
    kind === "spec"
      ? "docs/specs/approved-design.md"
      : "docs/plans/approved-plan.md";
  return {
    path,
    absolutePath: join(repoRoot, path),
    content: `# Approved ${kind}`,
    evidence: `approved ${kind} fixture`,
  };
}

test("approved spec without a resolvable spec fails safely", async () => {
  const { config, issue } = await fixture();
  issue.labels = [config.approvalPolicy.specApproval.approvedLabel];

  await assert.rejects(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      resolvedArtifacts: {},
      now,
    }),
    /spec-approved.*no spec artifact could be resolved/u,
  );
});

test("approved plan without a resolvable plan fails safely", async () => {
  const { config, issue } = await fixture();
  issue.labels = [config.approvalPolicy.planApproval.approvedLabel];

  await assert.rejects(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      resolvedArtifacts: {},
      now,
    }),
    /plan-approved.*no plan artifact could be resolved/u,
  );
});

test("resolved approved artifacts pass preflight", async () => {
  const { config, issue } = await fixture();
  issue.labels = [
    config.approvalPolicy.specApproval.approvedLabel,
    config.approvalPolicy.planApproval.approvedLabel,
  ];

  await assert.doesNotReject(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      resolvedArtifacts: {
        spec: source(config.repoRoot, "spec"),
        plan: source(config.repoRoot, "plan"),
      },
      now,
    }),
  );
});

test("approved spec with multiple discovered specs fails as ambiguous", async () => {
  const { config, issue } = await fixture();
  issue.labels = [config.approvalPolicy.specApproval.approvedLabel];
  await mkdir(config.specsDir, { recursive: true });
  await writeFile(
    join(config.specsDir, "2026-08-01-issue-140-first-design.md"),
    "# First spec\n",
    "utf8",
  );
  await writeFile(
    join(config.specsDir, "2026-08-02-issue-140-second-design.md"),
    "# Second spec\n",
    "utf8",
  );

  await assert.rejects(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      resolvedArtifacts: {},
      now,
    }),
    /spec-approved.*multiple spec artifacts/u,
  );
});

test("stale saved approved spec does not bypass ambiguous discovery", async () => {
  const { config, issue } = await fixture();
  issue.labels = [config.approvalPolicy.specApproval.approvedLabel];
  await mkdir(config.specsDir, { recursive: true });
  await writeFile(
    join(config.specsDir, "2026-08-01-issue-140-first-design.md"),
    "# First spec\n",
    "utf8",
  );
  await writeFile(
    join(config.specsDir, "2026-08-02-issue-140-second-design.md"),
    "# Second spec\n",
    "utf8",
  );

  await assert.rejects(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      existingState: {
        issueNumber: issue.number,
        title: issue.title,
        status: "planning",
        specPath: "docs/specs/stale-design.md",
      },
      resolvedArtifacts: {},
      now,
    }),
    /spec-approved.*multiple spec artifacts/u,
  );
});

test("approved published artifact rejects a conflicting local target", async () => {
  const { config, issue } = await fixture();
  issue.labels = [config.approvalPolicy.specApproval.approvedLabel];
  const resolved = source(config.repoRoot, "spec");
  await mkdir(config.specsDir, { recursive: true });
  await writeFile(resolved.absolutePath, "# Different local spec\n", "utf8");

  await assert.rejects(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      resolvedArtifacts: { spec: resolved },
      now,
    }),
    /spec-approved.*would overwrite existing spec artifact/u,
  );
});

test("approved published artifact rejects a conflicting saved worktree target", async () => {
  const { config, issue } = await fixture();
  issue.labels = [config.approvalPolicy.specApproval.approvedLabel];
  const resolved = source(config.repoRoot, "spec");
  const worktreePath = "worktrees/issue-140";
  const worktreeArtifactPath = join(
    config.repoRoot,
    worktreePath,
    resolved.path,
  );
  await mkdir(join(config.repoRoot, worktreePath, "docs", "specs"), {
    recursive: true,
  });
  await writeFile(worktreeArtifactPath, "# Stale worktree spec\n", "utf8");

  await assert.rejects(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      existingState: {
        issueNumber: issue.number,
        title: issue.title,
        status: "implementing",
        worktreePath,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      resolvedArtifacts: { spec: resolved },
      now,
    }),
    /spec-approved.*would overwrite existing spec artifact/u,
  );
});

test("approved published artifact rejects a conflicting fallback resume target", async () => {
  const { config, issue } = await fixture();
  issue.labels = [config.approvalPolicy.specApproval.approvedLabel];
  const resolved = source(config.repoRoot, "spec");
  const worktreePath = "worktrees/issue-140";
  await mkdir(config.specsDir, { recursive: true });
  await writeFile(resolved.absolutePath, "# Stale fallback spec\n", "utf8");

  await assert.rejects(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      existingState: {
        issueNumber: issue.number,
        title: issue.title,
        status: "implementing",
        worktreePath,
        specPath: resolved.path,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      resolvedArtifacts: { spec: resolved },
      now,
    }),
    /spec-approved.*would overwrite existing spec artifact/u,
  );
});

test("approved explicit plan passes preflight with a saved spec and no saved plan", async () => {
  const { config, issue } = await fixture();
  issue.labels = [config.approvalPolicy.planApproval.approvedLabel];
  const worktreePath = "worktrees/issue-140";
  const specPath = "docs/specs/saved-spec.md";
  await mkdir(join(config.repoRoot, worktreePath, "docs", "specs"), {
    recursive: true,
  });
  await writeFile(
    join(config.repoRoot, worktreePath, specPath),
    "# Saved spec\n",
    "utf8",
  );

  await assert.doesNotReject(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      existingState: {
        issueNumber: issue.number,
        title: issue.title,
        status: "planning",
        worktreePath,
        specPath,
        specCommit: "saved-spec-commit",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      resolvedArtifacts: { plan: source(config.repoRoot, "plan") },
      now,
    }),
  );
});

test("approved branch-only resume resolves saved artifacts in the ensured workspace", async () => {
  const { config, issue } = await fixture();
  issue.labels = [config.approvalPolicy.specApproval.approvedLabel];
  const worktreePath = "worktrees/issue-140";
  const specPath = "docs/specs/saved-spec.md";
  await mkdir(join(config.repoRoot, worktreePath, "docs", "specs"), {
    recursive: true,
  });
  await writeFile(
    join(config.repoRoot, worktreePath, specPath),
    "# Saved spec\n",
    "utf8",
  );
  let ensured = false;

  const preflight = await assertApprovedArtifactsResolvable({
    config,
    issue,
    existingState: {
      issueNumber: issue.number,
      title: issue.title,
      status: "implementing",
      branch: "agent/issue-140-keep-approved-artifacts",
      specPath,
      specCommit: "saved-spec-commit",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    resolvedArtifacts: {},
    now,
    ensureArtifactWorkspace: async () => {
      ensured = true;
      return { worktreePath };
    },
  });

  assert.equal(ensured, true);
  assert.equal(preflight?.policy.kind, "implementation-resume");
  assert.equal(preflight?.artifacts.spec.path, specPath);
  assert.equal(preflight?.artifacts.spec.exists, true);
});

test("approved explicit plan must match a saved implementation resume plan", async () => {
  const { config, issue } = await fixture();
  issue.labels = [config.approvalPolicy.planApproval.approvedLabel];
  const worktreePath = "worktrees/issue-140";
  const resolved = source(config.repoRoot, "plan");

  await assert.rejects(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      existingState: {
        issueNumber: issue.number,
        title: issue.title,
        status: "implementing",
        branch: "agent/issue-140-keep-approved-artifacts",
        worktreePath,
        planPath: "docs/plans/saved-plan.md",
        planCommit: "saved-plan-commit",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      resolvedArtifacts: { plan: resolved },
      now,
    }),
    /plan-approved.*Explicit plan artifact.*does not match saved plan/u,
  );
});

test("approved branch-only resume rejects an explicit artifact that differs from saved identity", async () => {
  const { config, issue } = await fixture();
  issue.labels = [config.approvalPolicy.planApproval.approvedLabel];
  const worktreePath = "worktrees/issue-140";

  await assert.rejects(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      existingState: {
        issueNumber: issue.number,
        title: issue.title,
        status: "implementing",
        branch: "agent/issue-140-keep-approved-artifacts",
        planPath: "docs/plans/saved-plan.md",
        planCommit: "saved-plan-commit",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      resolvedArtifacts: { plan: source(config.repoRoot, "plan") },
      now,
      ensureArtifactWorkspace: async () => ({ worktreePath }),
    }),
    /plan-approved.*Explicit plan artifact.*does not match saved plan/u,
  );
});

test("preflight uses configured approval label names", async () => {
  const { config, issue } = await fixture();
  config.approvalPolicy = createWorkflowApprovalPolicy({
    ...DEFAULT_PATCHMILL_CONFIG.workflow,
    specApproval: {
      ...DEFAULT_PATCHMILL_CONFIG.workflow.specApproval,
      required: true,
      approvedLabel: "spec-reviewed",
    },
  });
  issue.labels = ["spec-reviewed"];

  await assert.rejects(
    assertApprovedArtifactsResolvable({
      config,
      issue,
      resolvedArtifacts: {},
      now,
    }),
    /spec-reviewed.*no spec artifact could be resolved/u,
  );
});
