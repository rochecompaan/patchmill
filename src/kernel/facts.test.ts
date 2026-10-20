import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createGitFixture } from "../../test-support/git-fixture.ts";
import { DEFAULT_CONFIG } from "../config/config.ts";
import type { Host, Issue, PullRequest } from "../host/types.ts";
import {
  CommandFailedError,
  runCommand,
  type CommandRunner,
} from "../process/command.ts";
import { collectFacts, provisionWorkspace } from "./facts.ts";
import { createKernelGit } from "./git.ts";

const issue: Issue = {
  number: 9,
  title: "X",
  body: "",
  labels: [],
  state: "open",
  url: "https://example.invalid/9",
  author: "tester",
  createdAt: "2026-10-15",
  comments: [],
};

async function setup(t: TestContext) {
  const fixture = await createGitFixture();
  t.after(() => fs.rm(fixture.dir, { recursive: true, force: true }));
  const runner: CommandRunner = (command, args, options) =>
    runCommand(command, args, { ...options, env: fixture.env });
  const git = async (args: string[], cwd = fixture.repoRoot) => {
    const result = await runner("git", args, { cwd });
    if (result.code !== 0) throw new CommandFailedError("git", args, result);
    return result.stdout.trim();
  };
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected host mutation/query");
  };
  let pr: PullRequest | undefined;
  const host: Host = {
    checkCli: unexpected,
    listOpenIssues: unexpected,
    viewIssue: unexpected,
    listLabels: unexpected,
    createLabel: unexpected,
    setLabels: unexpected,
    commentIssue: unexpected,
    repository: async () => ({
      owner: "fixture",
      repo: "repo",
      defaultBranch: "host-base",
    }),
    pushRepository: async () => "fixture/repo",
    listPullRequests: async (branch) => (pr?.headBranch === branch ? [pr] : []),
  };
  const config = structuredClone(DEFAULT_CONFIG);
  config.paths.specsDir = "custom/specs";
  config.paths.plansDir = "custom/plans";
  config.paths.worktreeDir = "trees";
  let nowCalls = 0;
  const deps = {
    git: createKernelGit(runner, fixture.repoRoot),
    host,
    config,
    repoRoot: fixture.repoRoot,
    now: () => {
      nowCalls++;
      return new Date(2026, 9, 15, 23, 59);
    },
  };
  const provision = async (input = issue) => {
    const result = await provisionWorkspace(deps, input);
    assert.equal(result.kind, "facts");
    if (result.kind !== "facts") throw new Error("Expected facts");
    return result.facts;
  };
  return {
    ...fixture,
    git,
    deps,
    config,
    provision,
    setPr: (value: PullRequest) => {
      pr = value;
    },
    nowCalls: () => nowCalls,
  };
}

test("zero remote branches creates today's paths on remote HEAD, not local HEAD", async (t) => {
  const c = await setup(t);
  await c.git(["commit", "--allow-empty", "-m", "Local divergence"]);
  const facts = await c.provision();
  assert.deepEqual(facts, {
    branch: "agent/issue-9-x",
    remoteBranchExists: false,
    worktree: join(c.repoRoot, "trees/agent-issue-9-x"),
    baseBranch: "main",
    expectedSpecPath: "custom/specs/2026-10-15-issue-9-design.md",
    expectedPlanPath: "custom/plans/2026-10-15-issue-9-plan.md",
    stage: "implementation",
  });
  assert.equal(
    await c.git(["rev-parse", "HEAD"], facts.worktree),
    await c.git(["rev-parse", "origin/main"]),
  );
  assert.equal(c.nowCalls(), 1);
});

test("fetch discovers one differently slugged branch and its PR and artifacts", async (t) => {
  const c = await setup(t);
  const seed = join(c.dir, "seed");
  await fs.mkdir(join(seed, "custom/specs"), { recursive: true });
  await fs.mkdir(join(seed, "custom/plans"), { recursive: true });
  await fs.writeFile(
    join(seed, "custom/specs/2026-10-15-issue-9-design.md"),
    "spec",
  );
  await fs.writeFile(
    join(seed, "custom/plans/2026-10-15-issue-9-plan.md"),
    "plan",
  );
  await c.git(["add", "."], seed);
  await c.git(["commit", "-m", "Artifacts"], seed);
  await c.git(["push", "origin", "HEAD:agent/issue-9-old-title"], seed);
  const pr: PullRequest = {
    number: 3,
    url: "https://example.invalid/3",
    state: "open",
    draft: true,
    body: "PR body",
    headRepository: "fixture/repo",
    headBranch: "agent/issue-9-old-title",
    baseBranch: "main",
  };
  c.setPr(pr);
  const facts = await c.provision({ ...issue, labels: ["custom-approved"] });
  assert.equal(facts.branch, "agent/issue-9-old-title");
  assert.equal(facts.remoteBranchExists, true);
  assert.equal(facts.specPath, "custom/specs/2026-10-15-issue-9-design.md");
  assert.equal(facts.planPath, "custom/plans/2026-10-15-issue-9-plan.md");
  assert.equal(facts.stage, "implementation");
  assert.deepEqual(facts.pullRequest, pr);
  assert.equal(
    await c.git(["rev-parse", "HEAD"], facts.worktree),
    await c.git(["rev-parse", "origin/agent/issue-9-old-title"]),
  );
});

for (const source of ["base", "remote", "local", "worktree"] as const) {
  test(`observation reads ${source} artifacts without creating a branch or worktree`, async (t) => {
    const c = await setup(t);
    const seed = join(c.dir, "seed");
    const spec = "custom/specs/2026-10-15-issue-9-design.md";
    const head = {
      base: "main",
      remote: "agent/issue-9-x",
      local: "scratch",
      worktree: undefined,
    }[source];
    if (head) {
      await fs.mkdir(join(seed, "custom/specs"), { recursive: true });
      await fs.writeFile(join(seed, spec), "spec");
      await c.git(["add", "."], seed);
      await c.git(["commit", "-m", "Spec"], seed);
      await c.git(["push", "origin", `HEAD:${head}`], seed);
    }
    if (source === "local") {
      await c.git(["fetch", "origin"]);
      await c.git(["branch", "agent/issue-9-x", "origin/scratch"]);
    }
    if (source === "worktree") {
      const { worktree } = await c.provision();
      await fs.mkdir(join(worktree, "custom/specs"), { recursive: true });
      await fs.writeFile(join(worktree, spec), "uncommitted spec");
    }
    const state = () =>
      Promise.all([
        c.git(["for-each-ref", "--format=%(refname)", "refs/heads/"]),
        c.git(["worktree", "list", "--porcelain"]),
        fs.readdir(c.repoRoot),
      ]);
    const before = await state();
    const result = await collectFacts(c.deps, issue);
    assert.deepEqual(await state(), before);
    assert.equal(result.kind, "facts");
    if (result.kind !== "facts") return;
    assert.equal(result.facts.branch, "agent/issue-9-x");
    assert.equal(result.facts.remoteBranchExists, source === "remote");
    assert.equal(
      result.facts.worktree,
      join(c.repoRoot, "trees/agent-issue-9-x"),
    );
    assert.equal(result.facts.specPath, spec);
    assert.equal(result.facts.planPath, undefined);
  });
}

test("observation keeps worktree containment and branch checks", async (t) => {
  const c = await setup(t);
  c.config.paths.specsDir = "../outside";
  await assert.rejects(collectFacts(c.deps, issue), /outside.*worktree/i);
  c.config.paths.specsDir = "custom/specs";
  const { worktree } = await c.provision();
  await c.git(["checkout", "-b", "unrelated"], worktree);
  await assert.rejects(collectFacts(c.deps, issue), /expected branch/i);
});

test("multiple remote branches are ambiguous without creating a worktree", async (t) => {
  const c = await setup(t);
  await c.git(
    ["push", "origin", "HEAD:agent/issue-9-a", "HEAD:agent/issue-9-b"],
    join(c.dir, "seed"),
  );
  assert.deepEqual(await collectFacts(c.deps, issue), {
    kind: "ambiguous-branches",
    branches: ["agent/issue-9-a", "agent/issue-9-b"],
  });
  await assert.rejects(fs.stat(join(c.repoRoot, "trees")), { code: "ENOENT" });
});

for (const source of ["configured", "host"] as const) {
  test(`base branch uses ${source} fallback`, async (t) => {
    const c = await setup(t);
    const base = source === "configured" ? "configured-base" : "host-base";
    await c.git(["push", "origin", `HEAD:${base}`], join(c.dir, "seed"));
    if (source === "configured") {
      c.config.git.baseBranch = base;
      c.deps.git.remoteDefaultBranch = async () => {
        throw new Error("Should not query remote HEAD");
      };
    } else {
      // Recent Git fetches recreate origin/HEAD unless explicitly disabled.
      await c.git(["config", "remote.origin.followRemoteHEAD", "never"]);
      await fs.unlink(join(c.repoRoot, ".git/refs/remotes/origin/HEAD"));
    }
    if (source === "configured")
      c.deps.host.repository = async () => {
        throw new Error("Should not query host");
      };
    const facts = await c.provision();
    assert.equal(facts.baseBranch, base);
    assert.equal(
      await c.git(["rev-parse", "HEAD"], facts.worktree),
      await c.git(["rev-parse", `origin/${base}`]),
    );
  });
}

test("only matching actual files count; multiple matches select the newest date", async (t) => {
  const c = await setup(t);
  const initial = await c.provision();
  const specs = join(initial.worktree, "custom/specs");
  const plans = join(initial.worktree, "custom/plans");
  await fs.mkdir(specs, { recursive: true });
  await fs.mkdir(plans, { recursive: true });
  await fs.writeFile(join(specs, "notes-issue-9.md"), "unrelated");
  await fs.writeFile(join(specs, "2026-12-31-issue-9-x-design.md"), "legacy");
  await fs.writeFile(join(plans, "2026-12-31-issue-9-x.md"), "legacy");
  await fs.writeFile(join(specs, "2026-12-31-issue-90-design.md"), "other");
  await fs.writeFile(join(plans, "2026-12-31-issue-90-plan.md"), "other");
  await fs.mkdir(join(specs, "2026-12-31-issue-9-design.md"));
  await fs.mkdir(join(plans, "2026-12-31-issue-9-plan.md"));
  assert.equal((await c.provision()).specPath, undefined);
  assert.equal((await c.provision()).planPath, undefined);
  for (const date of ["2026-10-15", "2025-12-31", "2026-10-14"]) {
    await fs.writeFile(join(specs, `${date}-issue-9-design.md`), "spec");
    await fs.writeFile(join(plans, `${date}-issue-9-plan.md`), "plan");
  }
  const facts = await c.provision();
  assert.equal(facts.specPath, "custom/specs/2026-10-15-issue-9-design.md");
  assert.equal(facts.planPath, "custom/plans/2026-10-15-issue-9-plan.md");
});

test("ungated empty title keeps the branch name without extra hyphens", async (t) => {
  const c = await setup(t);
  c.config.workflow.specApproval.required = false;
  const facts = await c.provision({ ...issue, title: "!!!" });
  assert.equal(facts.stage, "implementation");
  assert.equal(facts.branch, "agent/issue-9");
});

test("fetch, host and non-missing filesystem errors stay visible", async (t) => {
  const c = await setup(t);
  const facts = await c.provision();
  await fs.mkdir(join(facts.worktree, "custom"), { recursive: true });
  await fs.writeFile(join(facts.worktree, "custom/specs"), "not a directory");
  await assert.rejects(c.provision(), { code: "ENOTDIR" });
  await fs.unlink(join(facts.worktree, "custom/specs"));
  const failure = new Error("host failure");
  c.deps.host.listPullRequests = async () => {
    throw failure;
  };
  await assert.rejects(c.provision(), (error) => error === failure);
  await fs.rename(join(c.repoRoot, ".git"), join(c.repoRoot, "saved-git"));
  await assert.rejects(c.provision(), CommandFailedError);
});

for (const key of ["specsDir", "plansDir"] as const) {
  for (const mode of [
    "traversal",
    "absolute sibling",
    "missing escape",
    "symlink escape",
  ] as const) {
    test(`${key} rejects ${mode} outside the selected worktree`, async (t) => {
      const c = await setup(t);
      const { worktree } = await c.provision();
      // The sibling shares the complete root prefix: string-prefix checks are unsafe.
      const outside = `${worktree}-outside`;
      await fs.mkdir(outside);
      await fs.writeFile(
        join(outside, "2026-10-15-issue-9-design.md"),
        "outside spec",
      );
      await fs.writeFile(
        join(outside, "2026-10-15-issue-9-plan.md"),
        "outside plan",
      );
      if (mode === "traversal")
        c.config.paths[key] = "../agent-issue-9-x-outside";
      if (mode === "absolute sibling") c.config.paths[key] = outside;
      if (mode === "missing escape") c.config.paths[key] = `${outside}/missing`;
      if (mode === "symlink escape") {
        await fs.symlink(outside, join(worktree, "outside-link"), "dir");
        c.config.paths[key] = "outside-link";
      }
      await assert.rejects(c.provision(), /outside.*worktree/i);
    });
  }
}

test("in-tree absolute directories and symlink aliases retain relative artifact paths", async (t) => {
  const c = await setup(t);
  const { worktree } = await c.provision();
  await fs.mkdir(join(worktree, "artifacts"));
  await fs.writeFile(
    join(worktree, "artifacts/2026-10-15-issue-9-design.md"),
    "spec",
  );
  await fs.writeFile(
    join(worktree, "artifacts/2026-10-15-issue-9-plan.md"),
    "plan",
  );
  await fs.symlink(join(worktree, "artifacts"), join(worktree, "alias"), "dir");
  c.config.paths.specsDir = join(worktree, "artifacts");
  c.config.paths.plansDir = "alias";
  const facts = await c.provision();
  assert.equal(facts.specPath, "artifacts/2026-10-15-issue-9-design.md");
  assert.equal(facts.planPath, "alias/2026-10-15-issue-9-plan.md");
  assert.equal(
    facts.expectedSpecPath,
    "artifacts/2026-10-15-issue-9-design.md",
  );
  assert.equal(facts.expectedPlanPath, "alias/2026-10-15-issue-9-plan.md");
  c.config.paths.specsDir = join(worktree, "missing/specs");
  c.config.paths.plansDir = "missing/plans";
  const missing = await c.provision();
  assert.equal(missing.specPath, undefined);
  assert.equal(missing.planPath, undefined);
  assert.equal(
    missing.expectedSpecPath,
    "missing/specs/2026-10-15-issue-9-design.md",
  );
  assert.equal(
    missing.expectedPlanPath,
    "missing/plans/2026-10-15-issue-9-plan.md",
  );
});

test("canonical checks normalize a worktree reached through a root alias", async (t) => {
  const c = await setup(t);
  const initial = await c.provision();
  await fs.mkdir(join(initial.worktree, "custom/specs"), { recursive: true });
  await fs.writeFile(
    join(initial.worktree, "custom/specs/2026-10-15-issue-9-design.md"),
    "spec",
  );
  const alias = join(c.dir, "repo-alias");
  await fs.symlink(c.repoRoot, alias, "dir");
  c.deps.repoRoot = alias;
  const facts = await c.provision();
  assert.equal(facts.specPath, "custom/specs/2026-10-15-issue-9-design.md");
  assert.equal(
    await fs.realpath(facts.worktree),
    await fs.realpath(initial.worktree),
  );
});

test("issue title edits never change artifact roles in a shared directory", async (t) => {
  const c = await setup(t);
  await c.git(
    ["push", "origin", "HEAD:agent/issue-9-add-design"],
    join(c.dir, "seed"),
  );
  c.config.paths.plansDir = c.config.paths.specsDir;
  const { worktree } = await c.provision({ ...issue, title: "Add design" });
  await fs.mkdir(join(worktree, "custom/specs"), { recursive: true });
  await fs.writeFile(
    join(worktree, "custom/specs/2026-10-14-issue-9-design.md"),
    "spec",
  );
  await fs.writeFile(
    join(worktree, "custom/specs/2026-10-14-issue-9-plan.md"),
    "plan",
  );
  for (const title of ["Add design", "Add better design", "Plan"]) {
    const facts = await c.provision({ ...issue, title });
    assert.equal(facts.worktree, worktree);
    assert.equal(facts.specPath, "custom/specs/2026-10-14-issue-9-design.md");
    assert.equal(facts.planPath, "custom/specs/2026-10-14-issue-9-plan.md");
  }
});

for (const alias of [false, true]) {
  test(`hardlinked canonical spec and plan never supply both facts: directoryAlias=${alias}`, async (t) => {
    const c = await setup(t);
    const { worktree } = await c.provision();
    await fs.mkdir(join(worktree, "custom/specs"), { recursive: true });
    if (alias) {
      await fs.symlink(
        join(worktree, "custom/specs"),
        join(worktree, "plans-alias"),
        "dir",
      );
      c.config.paths.plansDir = "plans-alias";
    } else await fs.mkdir(join(worktree, "custom/plans"), { recursive: true });
    const spec = join(worktree, "custom/specs/2026-10-14-issue-9-design.md");
    const plan = join(
      worktree,
      c.config.paths.plansDir,
      "2026-10-14-issue-9-plan.md",
    );
    await fs.writeFile(spec, "one physical artifact");
    await fs.link(spec, plan);
    const facts = await c.provision();
    assert.equal(facts.specPath, "custom/specs/2026-10-14-issue-9-design.md");
    assert.equal(facts.planPath, undefined);
    await fs.unlink(plan);
    await fs.writeFile(plan, "distinct plan");
    assert.equal(
      (await c.provision()).planPath,
      `${c.config.paths.plansDir}/2026-10-14-issue-9-plan.md`,
    );
  });
}
