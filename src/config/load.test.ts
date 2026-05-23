import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { DEFAULT_PATCHMILL_CONFIG } from "./defaults.ts";
import { loadPatchmillConfig } from "./load.ts";

test("loadPatchmillConfig returns defaults when no file or env is present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const config = await loadPatchmillConfig(dir, {}, []);
  assert.equal(config.host.login, "triage-agent");
  assert.equal(config.paths.runStateDir, join(dir, ".patchmill/runs"));
  assert.equal(config.git.worktreePrefix, "patchmill-issue-");
  assert.deepEqual(config.cleanupHooks, []);
});

test("loadPatchmillConfig clones default arrays for each load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const first = await loadPatchmillConfig(dir, {}, []);
  const second = await loadPatchmillConfig(dir, {}, []);

  assert.notStrictEqual(first.labels.priorities, DEFAULT_PATCHMILL_CONFIG.labels.priorities);
  assert.notStrictEqual(first.paths.cleanStatusIgnorePrefixes, DEFAULT_PATCHMILL_CONFIG.paths.cleanStatusIgnorePrefixes);
  assert.notStrictEqual(first.labels.priorities, second.labels.priorities);
  assert.notStrictEqual(first.paths.cleanStatusIgnorePrefixes, second.paths.cleanStatusIgnorePrefixes);
  assert.notStrictEqual(first.projectPolicy, DEFAULT_PATCHMILL_CONFIG.projectPolicy);
  assert.notStrictEqual(first.projectPolicy, second.projectPolicy);
  assert.notStrictEqual(first.projectPolicy.contextFileNames, DEFAULT_PATCHMILL_CONFIG.projectPolicy.contextFileNames);
  assert.notStrictEqual(first.projectPolicy.contextFileNames, second.projectPolicy.contextFileNames);
  assert.notStrictEqual(first.projectPolicy.validation, DEFAULT_PATCHMILL_CONFIG.projectPolicy.validation);
  assert.notStrictEqual(first.projectPolicy.validation, second.projectPolicy.validation);
  assert.notStrictEqual(first.projectPolicy.validation.rules, DEFAULT_PATCHMILL_CONFIG.projectPolicy.validation.rules);
  assert.notStrictEqual(first.projectPolicy.validation.rules, second.projectPolicy.validation.rules);
  assert.notStrictEqual(
    first.projectPolicy.validation.forbiddenSubstitutions,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.validation.forbiddenSubstitutions,
  );
  assert.notStrictEqual(first.projectPolicy.validation.forbiddenSubstitutions, second.projectPolicy.validation.forbiddenSubstitutions);
  assert.notStrictEqual(first.projectPolicy.directLand, DEFAULT_PATCHMILL_CONFIG.projectPolicy.directLand);
  assert.notStrictEqual(first.projectPolicy.directLand, second.projectPolicy.directLand);
  assert.notStrictEqual(first.projectPolicy.pi, DEFAULT_PATCHMILL_CONFIG.projectPolicy.pi);
  assert.notStrictEqual(first.projectPolicy.pi, second.projectPolicy.pi);
  assert.notStrictEqual(first.cleanupHooks, DEFAULT_PATCHMILL_CONFIG.cleanupHooks);
  assert.notStrictEqual(first.cleanupHooks, second.cleanupHooks);

  first.labels.priorities.push("priority:urgent");
  first.paths.cleanStatusIgnorePrefixes.push("scratch/");
  first.projectPolicy.contextFileNames.push("CONTRIBUTING.md");
  first.projectPolicy.validation.rules.push({ category: "Unit tests", commands: ["npm test"] });
  first.projectPolicy.validation.forbiddenSubstitutions.push("Do not skip tests.");
  first.projectPolicy.directLand.targetBranch = "release";
  first.projectPolicy.pi.todoWorkflowInstruction = "Custom todo guidance";
  first.cleanupHooks.push({ name: "custom-cleanup" });

  assert.deepEqual(second.labels.priorities, DEFAULT_PATCHMILL_CONFIG.labels.priorities);
  assert.deepEqual(second.paths.cleanStatusIgnorePrefixes, DEFAULT_PATCHMILL_CONFIG.paths.cleanStatusIgnorePrefixes);
  assert.deepEqual(second.projectPolicy.contextFileNames, DEFAULT_PATCHMILL_CONFIG.projectPolicy.contextFileNames);
  assert.deepEqual(second.projectPolicy.validation.rules, DEFAULT_PATCHMILL_CONFIG.projectPolicy.validation.rules);
  assert.deepEqual(
    second.projectPolicy.validation.forbiddenSubstitutions,
    DEFAULT_PATCHMILL_CONFIG.projectPolicy.validation.forbiddenSubstitutions,
  );
  assert.equal(second.projectPolicy.directLand.targetBranch, DEFAULT_PATCHMILL_CONFIG.projectPolicy.directLand.targetBranch);
  assert.equal(second.projectPolicy.pi.todoWorkflowInstruction, DEFAULT_PATCHMILL_CONFIG.projectPolicy.pi.todoWorkflowInstruction);
  assert.deepEqual(second.cleanupHooks, DEFAULT_PATCHMILL_CONFIG.cleanupHooks);
});

test("loadPatchmillConfig applies patchmill.config.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(join(dir, "patchmill.config.json"), JSON.stringify({
    host: { login: "bot-login" },
    pi: { team: "fast-team" },
    paths: {
      plansDir: "engineering/plans",
      cleanStatusIgnorePrefixes: ["scratch/", ".patchmill/custom-runs/"],
    },
    git: {
      baseRef: "refs/remotes/upstream/release/1.2",
      remote: "upstream",
      branchPrefix: "patchmill/issue-",
      worktreePrefix: "pm-issue-",
      slugLength: 32,
    },
    cleanupHooks: [
      {
        name: "custom-cleanup",
        whenPathExists: ".env",
        command: "just",
        args: ["cleanup"],
      },
    ],
    projectPolicy: {
      projectName: "Factory",
      contextFileNames: ["AGENTS.md", "CONTRIBUTING.md"],
      toolchainInstruction: "Use pnpm from the repository toolchain.",
      validation: {
        rules: [{ category: "Unit tests", commands: ["pnpm test"] }],
        forbiddenSubstitutions: ["Do not skip required validation."],
      },
      directLand: {
        policyText: "Land through a PR unless a human explicitly approves direct landing.",
        targetBranch: "release/1.2",
      },
      visualEvidence: {
        policyText: "Capture screenshots for visible UI changes.",
      },
      hostToolingInstruction: "Use the configured repository host tooling.",
      pi: {
        todoWorkflowInstruction: "Track implementation tasks with Pi todos.",
        subagentWorkflowInstruction: "Use Pi subagents for implementation and review.",
      },
      planRequiresApproval: true,
    },
  }));
  const config = await loadPatchmillConfig(dir, {}, []);
  assert.equal(config.host.login, "bot-login");
  assert.equal(config.pi.team, "fast-team");
  assert.equal(config.paths.plansDir, join(dir, "engineering/plans"));
  assert.deepEqual(config.paths.cleanStatusIgnorePrefixes, ["scratch/", ".patchmill/custom-runs/"]);
  assert.equal(config.git.baseRef, "refs/remotes/upstream/release/1.2");
  assert.equal(config.git.remote, "upstream");
  assert.equal(config.git.branchPrefix, "patchmill/issue-");
  assert.equal(config.git.worktreePrefix, "pm-issue-");
  assert.equal(config.git.slugLength, 32);
  assert.deepEqual(config.cleanupHooks, [
    {
      name: "custom-cleanup",
      whenPathExists: ".env",
      command: "just",
      args: ["cleanup"],
    },
  ]);
  assert.equal(config.projectPolicy.projectName, "Factory");
  assert.deepEqual(config.projectPolicy.contextFileNames, ["AGENTS.md", "CONTRIBUTING.md"]);
  assert.equal(config.projectPolicy.toolchainInstruction, "Use pnpm from the repository toolchain.");
  assert.deepEqual(config.projectPolicy.validation.rules, [{ category: "Unit tests", commands: ["pnpm test"] }]);
  assert.deepEqual(config.projectPolicy.validation.forbiddenSubstitutions, ["Do not skip required validation."]);
  assert.equal(
    config.projectPolicy.directLand.policyText,
    "Land through a PR unless a human explicitly approves direct landing.",
  );
  assert.equal(config.projectPolicy.directLand.targetBranch, "release/1.2");
  assert.equal(config.projectPolicy.visualEvidence.policyText, "Capture screenshots for visible UI changes.");
  assert.equal(config.projectPolicy.hostToolingInstruction, "Use the configured repository host tooling.");
  assert.equal(config.projectPolicy.pi.todoWorkflowInstruction, "Track implementation tasks with Pi todos.");
  assert.equal(
    config.projectPolicy.pi.subagentWorkflowInstruction,
    "Use Pi subagents for implementation and review.",
  );
  assert.equal(config.projectPolicy.planRequiresApproval, true);
});

test("loadPatchmillConfig applies env overrides without CLI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(join(dir, "patchmill.config.json"), JSON.stringify({
    host: { login: "file-login" },
    pi: { team: "file-team" }
  }));
  const config = await loadPatchmillConfig(
    dir,
    { PATCHMILL_HOST_LOGIN: "env-login", PATCHMILL_AGENT_TEAM: "env-team" },
    []
  );
  assert.equal(config.host.login, "env-login");
  assert.equal(config.pi.team, "env-team");
});

test("loadPatchmillConfig applies CLI overrides last", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const config = await loadPatchmillConfig(
    dir,
    { PATCHMILL_HOST_LOGIN: "env-login", PATCHMILL_AGENT_TEAM: "env-team" },
    ["--host-login", "cli-login", "--agent-team", "cli-team"]
  );
  assert.equal(config.host.login, "cli-login");
  assert.equal(config.pi.team, "cli-team");
});

test("loadPatchmillConfig accepts tea-login as a host-login alias", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  const config = await loadPatchmillConfig(dir, {}, ["--tea-login", "cli-login"]);
  assert.equal(config.host.login, "cli-login");
});

test("loadPatchmillConfig absolutizes paths from a relative repo root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(join(dir, "patchmill.config.json"), JSON.stringify({
    paths: {
      worktreeDir: "custom/../trees",
      cleanStatusIgnorePrefixes: ["scratch/", "logs/run-state/"],
    }
  }));
  const relativeRoot = relative(process.cwd(), dir);
  const config = await loadPatchmillConfig(relativeRoot, {}, []);
  assert.equal(config.paths.runStateDir, resolve(relativeRoot, ".patchmill/runs"));
  assert.equal(config.paths.worktreeDir, resolve(relativeRoot, "custom/../trees"));
  assert.deepEqual(config.paths.cleanStatusIgnorePrefixes, ["scratch/", "logs/run-state/"]);
});

test("loadPatchmillConfig reports invalid config field types", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(join(dir, "patchmill.config.json"), JSON.stringify({
    paths: { plansDir: null }
  }));

  await assert.rejects(
    loadPatchmillConfig(dir, {}, []),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.name, "Error");
      assert.match(error.message, /Invalid patchmill\.config\.json: paths\.plansDir must be a string; received null/);
      return true;
    }
  );
});

test("loadPatchmillConfig reports invalid clean-status ignore prefixes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(join(dir, "patchmill.config.json"), JSON.stringify({
    paths: { cleanStatusIgnorePrefixes: [".patchmill/runs/", 17] }
  }));

  await assert.rejects(
    loadPatchmillConfig(dir, {}, []),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.name, "Error");
      assert.match(
        error.message,
        /Invalid patchmill\.config\.json: paths\.cleanStatusIgnorePrefixes must be an array of strings/,
      );
      return true;
    }
  );
});

test("loadPatchmillConfig reports invalid git slug lengths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(join(dir, "patchmill.config.json"), JSON.stringify({
    git: { slugLength: 0 }
  }));

  await assert.rejects(
    loadPatchmillConfig(dir, {}, []),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.name, "Error");
      assert.match(
        error.message,
        /Invalid patchmill\.config\.json: git\.slugLength must be a positive integer/,
      );
      return true;
    }
  );
});

test("loadPatchmillConfig reports invalid project policy validation rules", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-config-"));
  await writeFile(join(dir, "patchmill.config.json"), JSON.stringify({
    projectPolicy: {
      validation: {
        rules: [{ category: "Unit tests", commands: [17] }],
      },
    },
  }));

  await assert.rejects(
    loadPatchmillConfig(dir, {}, []),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.name, "Error");
      assert.match(
        error.message,
        /Invalid patchmill\.config\.json: projectPolicy\.validation\.rules\[0\]\.commands must be an array of strings/,
      );
      return true;
    }
  );
});
