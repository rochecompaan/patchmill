import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import { createCommandRunner } from "../triage/command.ts";
import {
  assertApprovedArtifactsResolvable,
  type ApprovedArtifactPreflightOptions,
} from "./approval-artifact-preflight.ts";

const now = new Date("2026-08-02T12:00:00Z");
const branch = "agent/issue-140-keep-approved-artifacts";

async function fixture(t: TestContext, kind: "spec" | "plan") {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-artifact-fallback-"),
  );
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const runner = createCommandRunner();
  const git = async (...args: string[]) => {
    const result = await runner.run("git", args, { cwd: repoRoot });
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.trim();
  };
  await git("init", "-b", "main");
  await git("config", "user.email", "patchmill@example.test");
  await git("config", "user.name", "Patchmill Test");
  await git("commit", "--allow-empty", "-m", "Initial base");
  await git("branch", branch);

  const approvalPolicy = createWorkflowApprovalPolicy(
    DEFAULT_PATCHMILL_CONFIG.workflow,
  );
  const path =
    kind === "spec"
      ? "docs/specs/2026-08-02-issue-140-keep-approved-artifacts-design.md"
      : "docs/plans/2026-08-02-issue-140-keep-approved-artifacts.md";
  const content = `# Approved ${kind}\n`;
  const options: ApprovedArtifactPreflightOptions = {
    config: {
      repoRoot,
      specsDir: join(repoRoot, "docs", "specs"),
      plansDir: join(repoRoot, "docs", "plans"),
      approvalPolicy,
    },
    issue: {
      number: 140,
      title: "Keep approved artifacts",
      body: "Approved workflow artifacts",
      labels: [
        kind === "spec"
          ? approvalPolicy.specApproval.approvedLabel
          : approvalPolicy.planApproval.approvedLabel,
      ],
      state: "open",
      comments: [],
    },
    existingState: {
      issueNumber: 140,
      title: "Keep approved artifacts",
      status: "implementing",
      branch,
      ...(kind === "spec" ? { specPath: path } : { planPath: path }),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    resolvedArtifacts: {},
    now,
    artifactWorkspace: { kind: "branch", branch },
    runner,
  };
  return { options, git, path, content, repoRoot };
}

for (const kind of ["spec", "plan"] as const) {
  for (const source of ["repository", "published source"] as const) {
    test(`saved approved ${kind} can come from the ${source} without existing on the issue branch`, async (t) => {
      const { options, git, path, content, repoRoot } = await fixture(t, kind);
      if (source === "repository") {
        await mkdir(dirname(join(repoRoot, path)), { recursive: true });
        await writeFile(join(repoRoot, path), content, "utf8");
        await git("add", path);
        await git("commit", "-m", `Add approved ${kind} on main`);
      } else {
        options.resolvedArtifacts = {
          [kind]: {
            path,
            absolutePath: join(repoRoot, path),
            content,
            evidence: `approved ${kind} from issue comment`,
          },
        };
      }

      const preflight = await assertApprovedArtifactsResolvable(options);

      assert.equal(preflight?.artifacts[kind].path, path);
      assert.equal(preflight?.artifacts[kind].exists, true);
      assert.equal(preflight?.artifacts[kind].generated, false);
      const missing = await options.runner!.run(
        "git",
        ["cat-file", "-e", `${branch}:${path}`],
        { cwd: repoRoot },
      );
      assert.notEqual(
        missing.code,
        0,
        "preflight must not modify the issue branch",
      );
    });
  }

  test(`saved approved ${kind} still fails when no source can be resolved`, async (t) => {
    const { options } = await fixture(t, kind);

    await assert.rejects(
      assertApprovedArtifactsResolvable(options),
      new RegExp(`no ${kind} artifact could be resolved`, "u"),
    );
  });
}
