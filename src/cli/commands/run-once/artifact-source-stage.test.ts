import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { runArtifactExtractionStage } from "./artifact-source-stage.ts";
import type { IssueHostProvider } from "../../../host/types.ts";
import type { AgentIssueConfig, IssueSummary } from "./types.ts";

async function makeConfig(): Promise<AgentIssueConfig> {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-artifact-stage-"));
  return {
    repoRoot,
    dryRun: false,
    execute: true,
    planOnly: false,
    host: DEFAULT_PATCHMILL_CONFIG.host,
    specsDir: join(repoRoot, "docs", "specs"),
    plansDir: join(repoRoot, "docs", "plans"),
    runStateDir: join(repoRoot, ".patchmill", "runs"),
    worktreeDir: join(repoRoot, ".worktrees"),
    projectPolicy: DEFAULT_PATCHMILL_CONFIG.projectPolicy,
    skills: DEFAULT_PATCHMILL_CONFIG.skills,
    triagePolicy: undefined,
    readyLabel: DEFAULT_PATCHMILL_CONFIG.labels.ready,
    issueLimit: 1,
    labelCatalog: {
      labelDefinitions: [],
      priorities: [],
      types: [],
    },
    approvalPolicy: {
      spec: {
        required: false,
        reviewLabel: "spec-review",
        approvedLabel: "spec-approved",
      },
      plan: {
        required: false,
        reviewLabel: "plan-review",
        approvedLabel: "plan-approved",
      },
    },
    baseBranch: DEFAULT_PATCHMILL_CONFIG.git.baseBranch,
    baseRef: DEFAULT_PATCHMILL_CONFIG.git.baseRef,
    remote: DEFAULT_PATCHMILL_CONFIG.git.remote,
    branchPrefix: DEFAULT_PATCHMILL_CONFIG.git.branchPrefix,
    worktreePrefix: DEFAULT_PATCHMILL_CONFIG.git.worktreePrefix,
    slugLength: DEFAULT_PATCHMILL_CONFIG.git.slugLength,
    allowDirectLand: DEFAULT_PATCHMILL_CONFIG.git.allowDirectLand,
  };
}

const host: IssueHostProvider = {
  id: "forgejo-tea",
  displayName: "Forgejo via tea",
  async checkCli() {
    return { ok: true, message: "ok" };
  },
  missingLabelRemediation() {
    return "";
  },
  async listOpenIssues() {
    return [];
  },
  async viewIssue() {
    throw new Error("unused");
  },
  async hydrateIssueComments(issues) {
    return issues;
  },
  async trustedTriageCommentAuthors() {
    return [];
  },
  async listLabels() {
    return [];
  },
  async createLabel() {},
  async applyLabels() {},
  async commentIssue() {},
};

const issue: IssueSummary = {
  number: 99,
  title: "Needs deterministic artifacts",
  body: "Plain issue body without published artifacts",
  labels: ["agent-ready"],
  state: "open",
  comments: [],
};

test("runArtifactExtractionStage only reads deterministic artifacts and does not call Pi", async () => {
  const config = await makeConfig();
  const steps: string[] = [];
  const progressMessages: string[] = [];

  const result = await runArtifactExtractionStage({
    host,
    config,
    issue,
    now: new Date("2026-07-09T00:00:00Z"),
    progress: async (_level, _stage, message) => {
      progressMessages.push(message);
    },
    runStep: async (label, fn) => {
      steps.push(label);
      return await fn();
    },
  });

  assert.deepEqual(result.resolvedArtifacts, {});
  assert.deepEqual(steps, ["extract issue artifact sources"]);
  assert.deepEqual(progressMessages, [
    "hydrating issue artifact content",
    "reading deterministic issue artifact sources",
  ]);
});
