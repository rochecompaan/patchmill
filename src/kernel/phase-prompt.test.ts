import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { DEFAULT_CONFIG } from "../config/config.ts";
import type { Issue } from "../host/types.ts";
import type { Facts } from "./facts.ts";
import { preparePhasePrompt } from "./interactive-loop.ts";

const issue: Issue = {
  number: 9,
  title: "X",
  body: "Body",
  labels: [],
  state: "open",
  url: "https://example.invalid/issues/9",
  author: "maintainer",
  createdAt: "2026-10-15",
  comments: [],
};
const facts: Facts = {
  worktree: "/trees/issue-9",
  branch: "agent/issue-9-x",
  baseBranch: "main",
  remoteBranchExists: false,
  expectedSpecPath: "docs/specs/x-design.md",
  expectedPlanPath: "docs/plans/x-plan.md",
  stage: "spec",
};

async function prepare(t: TestContext, timeoutMinutes: number | null) {
  const repoRoot = await fs.mkdtemp(join(tmpdir(), "patchmill-phase-prompt-"));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const runDir = join(repoRoot, "runs", "issue-9", "run-1");
  await fs.mkdir(runDir, { recursive: true });
  const config = structuredClone(DEFAULT_CONFIG);
  config.pi.timeoutMinutes = timeoutMinutes;
  const host = {
    repository: async () => ({ owner: "o", repo: "r", defaultBranch: "main" }),
    checkCli: async () => ({ login: "maintainer" }),
  };
  const { launch } = await preparePhasePrompt(
    config,
    {
      host: host as never,
      repoRoot,
      piCommand: { command: "pi" },
      extensionPaths: [],
    },
    runDir,
    issue,
    "planning",
    facts,
    1,
  );
  return { launch, agentDir: join(repoRoot, config.pi.agentDir) };
}

test("no timeoutMs without a cap", async (t) => {
  const { launch } = await prepare(t, null);
  assert.equal(launch.timeoutMs, undefined);
  assert.doesNotMatch(launch.envelope, /Time limit/);
});

test("timeoutMs is the cap in milliseconds with a cap", async (t) => {
  const { launch } = await prepare(t, 120);
  assert.equal(launch.timeoutMs, 7_200_000);
  assert.match(launch.envelope, /- Time limit: 120 minutes\./);
});

test("writes the subagent limits and the reviewer before the launch", async (t) => {
  const { agentDir } = await prepare(t, 120);
  const limits = JSON.parse(
    await fs.readFile(
      join(agentDir, "extensions", "subagent", "config.json"),
      "utf8",
    ),
  );
  assert.equal(limits.timeoutMs, 7_200_000);
  assert.match(
    await fs.readFile(join(agentDir, "agents", "reviewer.md"), "utf8"),
    /^timeoutMs: 7200000$/m,
  );
});
