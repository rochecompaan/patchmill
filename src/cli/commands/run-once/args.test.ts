import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { cwd } from "node:process";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { HELP_TEXT, loadCliConfig, summarizeResult } from "./main.ts";
import { DEFAULT_PATCHMILL_POLICY } from "../../../policy/defaults.ts";
import {
  LEGACY_RUN_ONCE_LOGIN_ENV,
  LEGACY_TRIAGE_LOGIN_ENV,
  literalPattern,
} from "../../../../test-support/legacy-seed.ts";
import { createStaticCommandRunner } from "../../../../test-support/command-runner.ts";
import { parseArgs } from "./args.ts";

test("parseArgs executes by default when no args are provided", () => {
  const config = parseArgs([], cwd(), {});

  assert.equal(config.showHelp, false);
  assert.equal(config.repoRoot, cwd());
  assert.equal(config.dryRun, false);
  assert.equal(config.execute, true);
  assert.equal(config.issueNumber, undefined);
  assert.equal(config.planOnly, false);
  assert.equal(config.teaLogin, "triage-agent");
  assert.equal(config.specsDir, join(cwd(), "docs", "specs"));
  assert.equal(config.plansDir, join(cwd(), "docs", "plans"));
  assert.equal(config.runStateDir, join(cwd(), ".patchmill", "runs"));
  assert.equal(config.worktreeDir, join(cwd(), ".worktrees"));
  assert.equal(config.worktreePrefix, "patchmill-issue-");
  assert.deepEqual(config.cleanStatusIgnorePrefixes, [
    ".patchmill/runs/",
    ".patchmill/triage-runs/",
  ]);
  assert.equal(config.cleanupHook, undefined);
  assert.deepEqual(config.projectPolicy, DEFAULT_PATCHMILL_POLICY);
  assert.equal(config.readyLabel, "agent-ready");
  assert.equal(config.issueLimit, 1);
  assert.equal(config.approvalPolicy.specApproval.required, false);
  assert.equal(config.approvalPolicy.planApproval.required, false);
  assert.equal(
    config.approvalPolicy.planApproval.approvedLabel,
    "plan-approved",
  );
});

test("parseArgs shows help for help flags", () => {
  assert.equal(parseArgs(["--help"], "/repo", {}).showHelp, true);
  assert.equal(parseArgs(["-h"], "/repo", {}).showHelp, true);
});

test("parseArgs keeps help sticky when combined with other flags", () => {
  for (const args of [
    ["--help", "--dry-run"],
    ["--help", "--quiet"],
    ["--help", "--verbose-pi-output"],
    ["--dry-run", "--help"],
  ]) {
    assert.equal(parseArgs(args, "/repo", {}).showHelp, true);
  }
});

test("parseArgs does not show help when an option is provided", () => {
  assert.equal(parseArgs(["--dry-run"], "/repo", {}).showHelp, false);
});

test("parseArgs carries normalized github host config", () => {
  const config = parseArgs(
    ["--dry-run"],
    "/repo",
    {},
    {
      ...DEFAULT_PATCHMILL_CONFIG,
      host: { provider: "github-gh", login: "" },
    },
  );
  assert.deepEqual(config.host, { provider: "github-gh", login: "" });
});

test("parseArgs applies host-login to host config", () => {
  const config = parseArgs(
    ["--host-login", "operator"],
    "/repo",
    {},
    DEFAULT_PATCHMILL_CONFIG,
  );
  assert.equal(config.host.login, "operator");
});

test("HELP_TEXT documents one-issue usage and host-neutral options", () => {
  assert.match(HELP_TEXT, /Usage:/);
  assert.match(HELP_TEXT, /patchmill run-once/);
  assert.match(
    HELP_TEXT,
    /Advance one actionable issue through spec, plan, or implementation/,
  );
  assert.match(HELP_TEXT, /Claims and processes one eligible issue by default/);
  assert.doesNotMatch(HELP_TEXT, /Process one Forgejo issue/);
  assert.match(HELP_TEXT, /without mutating the configured issue host or git/);
  assert.doesNotMatch(HELP_TEXT, /without mutating Forgejo or git/);
  assert.match(HELP_TEXT, /--help/);
  assert.match(HELP_TEXT, /--dry-run/);
  assert.doesNotMatch(HELP_TEXT, /--execute/);
  assert.match(HELP_TEXT, /--plan-only/);
  assert.match(HELP_TEXT, /--issue <number>/);
  assert.match(HELP_TEXT, /--host-login <name>/);
  assert.match(
    HELP_TEXT,
    /Use a named host login when the provider supports named logins/,
  );
  assert.doesNotMatch(HELP_TEXT, /Forgejo issue updates/);
  assert.match(HELP_TEXT, /--tea-login <name>/);
  assert.match(HELP_TEXT, /Compatibility alias for --host-login/);
  assert.match(HELP_TEXT, /PATCHMILL_HOST_LOGIN/);
  assert.doesNotMatch(HELP_TEXT, literalPattern(LEGACY_RUN_ONCE_LOGIN_ENV));
  assert.doesNotMatch(HELP_TEXT, literalPattern(LEGACY_TRIAGE_LOGIN_ENV));
});

test("parseArgs rejects removed execute flag", () => {
  assert.throws(
    () => parseArgs(["--execute"], "/repo"),
    /Unknown argument: --execute/,
  );
});

test("parseArgs accepts quiet mode", () => {
  const config = parseArgs(["--quiet"], "/repo", {});

  assert.equal(config.quiet, true);
  assert.equal(config.showHelp, false);
});

test("parseArgs enables verbose Pi output", () => {
  const config = parseArgs(["--verbose-pi-output"], "/repo", {});

  assert.equal(config.verbosePiOutput, true);
  assert.equal(config.execute, true);
});

test("HELP_TEXT documents quiet mode and run logs", () => {
  assert.match(HELP_TEXT, /--quiet/);
  assert.match(HELP_TEXT, /stderr/);
  assert.match(HELP_TEXT, /\.patchmill\/runs/);
});

test("help text documents verbose Pi output", () => {
  assert.match(HELP_TEXT, /--verbose-pi-output/);
});

test("help text omits removed Forgejo visual evidence upload environment", () => {
  assert.doesNotMatch(HELP_TEXT, /PATCHMILL_FORGEJO_URL/);
  assert.doesNotMatch(HELP_TEXT, /PATCHMILL_FORGEJO_TOKEN/);
  assert.doesNotMatch(HELP_TEXT, /PATCHMILL_FORGEJO_REPO/);
  assert.doesNotMatch(HELP_TEXT, /Compatibility fallback/);
});

test("summarizeResult includes merged issue handoff fields", () => {
  assert.deepEqual(
    summarizeResult({
      status: "merged",
      issue: {
        number: 42,
        title: "Add once runner helpers",
        body: "Body",
        labels: ["bug"],
        state: "open",
      },
      planPath: "docs/plans/plan.md",
      branch: "agent/issue-42-add-once-runner-helpers",
      mergeCommit: "abc123",
      worktreePath: ".worktrees/agent-issue-42-add-once-runner-helpers",
      commits: ["def456"],
      validation: ["just agent-issue-test ok"],
      reviewSummary: "reviewed",
      landingDecision: "direct squash-landed: simple localized bug fix",
      logPath: ".patchmill/runs/issue-42/run.jsonl",
      piSessionPath: ".patchmill/runs/issue-42/run-pi-sessions",
    }),
    {
      status: "merged",
      issueNumber: 42,
      planPath: "docs/plans/plan.md",
      branch: "agent/issue-42-add-once-runner-helpers",
      mergeCommit: "abc123",
      worktreePath: ".worktrees/agent-issue-42-add-once-runner-helpers",
      commits: ["def456"],
      validation: ["just agent-issue-test ok"],
      reviewSummary: "reviewed",
      landingDecision: "direct squash-landed: simple localized bug fix",
      logPath: ".patchmill/runs/issue-42/run.jsonl",
      piSessionPath: ".patchmill/runs/issue-42/run-pi-sessions",
    },
  );
});

test("summarizeResult includes spec-created details", () => {
  assert.deepEqual(
    summarizeResult({
      status: "spec-created",
      issue: { number: 42, title: "Spec", body: "", labels: [], state: "open" },
      specPath: "docs/specs/spec.md",
      logPath: ".patchmill/runs/run.jsonl",
    }),
    {
      status: "spec-created",
      issueNumber: 42,
      specPath: "docs/specs/spec.md",
      logPath: ".patchmill/runs/run.jsonl",
    },
  );
});

test("summarizeResult includes approval-required details", () => {
  assert.deepEqual(
    summarizeResult({
      status: "approval-required",
      issue: {
        number: 42,
        title: "Needs spec approval",
        body: "Body",
        labels: ["agent-ready"],
        state: "open",
      },
      approvalKind: "spec",
      missingLabel: "spec-approved",
      logPath: ".patchmill/runs/run.jsonl",
    }),
    {
      status: "approval-required",
      issueNumber: 42,
      approvalKind: "spec",
      missingLabel: "spec-approved",
      logPath: ".patchmill/runs/run.jsonl",
    },
  );
});

test("summarizeResult includes development-environment-not-ready remediation", () => {
  assert.deepEqual(
    summarizeResult({
      status: "development-environment-not-ready",
      issue: {
        number: 47,
        title: "Runtime missing",
        body: "Body",
        labels: ["plan-approved"],
        state: "open",
      },
      specPath: "docs/specs/spec.md",
      planPath: "docs/plans/plan.md",
      branch: "agent/issue-47-runtime-missing",
      worktreePath: ".worktrees/patchmill-issue-47-runtime-missing",
      reason: "Kubernetes API unavailable",
      evidence: ["localhost:8080 refused connection"],
      remediation: ["Run devenv shell -- just tilt-up"],
      logPath: ".patchmill/runs/run.jsonl",
    }),
    {
      status: "development-environment-not-ready",
      issueNumber: 47,
      specPath: "docs/specs/spec.md",
      planPath: "docs/plans/plan.md",
      branch: "agent/issue-47-runtime-missing",
      worktreePath: ".worktrees/patchmill-issue-47-runtime-missing",
      reason: "Kubernetes API unavailable",
      evidence: ["localhost:8080 refused connection"],
      remediation: ["Run devenv shell -- just tilt-up"],
      logPath: ".patchmill/runs/run.jsonl",
    },
  );
});

test("parseArgs accepts an explicit issue number", () => {
  const config = parseArgs(["--issue", "42"], "/repo");

  assert.equal(config.issueNumber, 42);
});

test("parseArgs accepts plan-only mode", () => {
  const config = parseArgs(["--plan-only"], "/repo");

  assert.equal(config.planOnly, true);
});

test("parseArgs accepts an explicit tea login", () => {
  const config = parseArgs(["--tea-login", "operator"], "/repo", {
    [LEGACY_RUN_ONCE_LOGIN_ENV]: "issue-agent",
    [LEGACY_TRIAGE_LOGIN_ENV]: "triage-agent",
  });

  assert.equal(config.teaLogin, "operator");
});

test("parseArgs accepts host-login as the primary tea login flag", () => {
  const config = parseArgs(["--host-login", "operator"], "/repo", {
    [LEGACY_RUN_ONCE_LOGIN_ENV]: "issue-agent",
  });

  assert.equal(config.teaLogin, "operator");
});

test("parseArgs ignores removed legacy host login variables", () => {
  const config = parseArgs(["--dry-run"], "/repo", {
    [LEGACY_RUN_ONCE_LOGIN_ENV]: "issue-agent",
    [LEGACY_TRIAGE_LOGIN_ENV]: "triage-agent-legacy",
  });
  assert.equal(config.teaLogin, "triage-agent");
});

test("parseArgs prefers PATCHMILL_HOST_LOGIN over legacy env values", () => {
  const config = parseArgs(["--dry-run"], "/repo", {
    PATCHMILL_HOST_LOGIN: "patchmill-bot",
    [LEGACY_RUN_ONCE_LOGIN_ENV]: "issue-agent",
    [LEGACY_TRIAGE_LOGIN_ENV]: "triage-agent",
  });

  assert.equal(config.teaLogin, "patchmill-bot");
});

test("loadCliConfig detects git.baseBranch when it is not configured", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "origin/master\n", stderr: "" },
  ]);

  const config = await loadCliConfig(["--dry-run"], repoRoot, {}, runner);

  assert.equal(config.baseBranch, "master");
  assert.deepEqual(runner.calls, [
    {
      command: "git",
      args: ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      cwd: repoRoot,
    },
  ]);
});

test("loadCliConfig does not detect git.baseBranch when it is explicit", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({ git: { baseBranch: "main" } }),
  );
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "origin/master\n", stderr: "" },
  ]);

  const config = await loadCliConfig(["--dry-run"], repoRoot, {}, runner);

  assert.equal(config.baseBranch, "main");
  assert.deepEqual(runner.calls, []);
});

test("loadCliConfig uses normalized Patchmill defaults when no config file exists", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-args-"));

  const config = await loadCliConfig([], repoRoot, {
    [LEGACY_RUN_ONCE_LOGIN_ENV]: "legacy-login",
  });

  assert.equal(config.teaLogin, "triage-agent");
  assert.equal(config.runStateDir, join(repoRoot, ".patchmill", "runs"));
  assert.equal(config.worktreePrefix, "patchmill-issue-");
  assert.equal(config.cleanupHook, undefined);
  assert.deepEqual(config.projectPolicy, DEFAULT_PATCHMILL_POLICY);
});

test("loadCliConfig applies normalized patchmill defaults for run-once", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      host: { login: "config-bot" },
      labels: {
        ready: "ready-for-bots",
        needsInfo: "needs-clarification",
        unsuitable: "manual-only",
        "in-progress": "claimed",
        done: "done-by-bot",
        blocked: "waiting",
        priorities: ["priority:p1", "priority:p2"],
      },
      paths: {
        specsDir: "pm-specs",
        plansDir: "pm-plans",
        runStateDir: ".patchmill/runs",
        triageLogDir: ".patchmill/triage-runs",
        worktreeDir: ".patchmill/worktrees",
        cleanStatusIgnorePrefixes: ["scratch/", ".patchmill/custom-runs/"],
      },
    }),
  );

  const config = await loadCliConfig([], repoRoot, {
    [LEGACY_RUN_ONCE_LOGIN_ENV]: "issue-agent",
  });

  assert.equal(config.showHelp, false);
  assert.equal(config.dryRun, false);
  assert.equal(config.execute, true);
  assert.equal(config.teaLogin, "config-bot");
  assert.equal(config.specsDir, join(repoRoot, "pm-specs"));
  assert.equal(config.plansDir, join(repoRoot, "pm-plans"));
  assert.equal(config.runStateDir, join(repoRoot, ".patchmill/runs"));
  assert.equal(config.worktreeDir, join(repoRoot, ".patchmill/worktrees"));
  assert.equal(config.worktreePrefix, "patchmill-issue-");
  assert.deepEqual(config.cleanStatusIgnorePrefixes, [
    "scratch/",
    ".patchmill/custom-runs/",
  ]);
  assert.equal(config.cleanupHook, undefined);
  assert.deepEqual(config.projectPolicy, DEFAULT_PATCHMILL_POLICY);
  assert.equal(config.readyLabel, "ready-for-bots");
  assert.deepEqual(config.triagePolicy?.runOnceSelection.priorityOrder, [
    "priority:p1",
    "priority:p2",
  ]);
  assert.deepEqual(config.triagePolicy?.runOnceSelection.excludedLabels, [
    "needs-clarification",
    "manual-only",
    "claimed",
    "done-by-bot",
    "waiting",
  ]);
});

test("loadCliConfig includes custom triage state aliases in run-once policy", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      labels: {
        ready: "ready-for-bots",
        needsInfo: "needs-clarification",
        unsuitable: "manual-only",
        "in-progress": "claimed",
        done: "done-by-bot",
        blocked: "waiting",
      },
      triage: {
        stateMap: {
          "ready-for-bots": "agent-ready",
          "needs-clarification": "needs-info",
          "manual-only": "agent-unsuitable",
          deferred: "needs-info",
          wontfix: "agent-unsuitable",
        },
      },
    }),
  );

  const config = await loadCliConfig(["--dry-run"], repoRoot, {});

  assert.deepEqual(config.triagePolicy?.stateMap, {
    "ready-for-bots": "agent-ready",
    "needs-clarification": "needs-info",
    "manual-only": "agent-unsuitable",
    deferred: "needs-info",
    wontfix: "agent-unsuitable",
  });
  assert.deepEqual(config.triagePolicy?.runOnceSelection.excludedLabels, [
    "needs-clarification",
    "manual-only",
    "claimed",
    "done-by-bot",
    "waiting",
    "deferred",
    "wontfix",
  ]);
});

test("loadCliConfig passes configured skills and project policy through to run-once prompts", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      skills: {
        developmentEnvironment: "sentinel-ready",
        implementation: "sentinel-implementation",
        visualEvidence: "sentinel-screenshots",
        landing: "sentinel-landing",
      },
      projectPolicy: {
        ...DEFAULT_PATCHMILL_POLICY,
        projectName: "Sentinel",
        visualEvidence: {
          referenceScreenshotPaths: ["docs/sentinel/web/"],
          prEvidenceExample: {
            screenshotPath: "docs/sentinel/web/sentinel-after.png",
            caption: "Sentinel after the change",
          },
        },
      },
    }),
  );

  const config = await loadCliConfig(["--dry-run"], repoRoot, {});

  assert.equal(config.projectPolicy.projectName, "Sentinel");
  assert.equal(config.skills.developmentEnvironment, "sentinel-ready");
  assert.equal(config.skills.implementation, "sentinel-implementation");
  assert.equal(config.skills.visualEvidence, "sentinel-screenshots");
  assert.equal(config.skills.landing, "sentinel-landing");
  assert.deepEqual(
    config.projectPolicy.visualEvidence.referenceScreenshotPaths,
    ["docs/sentinel/web/"],
  );
  assert.equal(
    config.projectPolicy.visualEvidence.prEvidenceExample?.screenshotPath,
    "docs/sentinel/web/sentinel-after.png",
  );
});

test("loadCliConfig resolves workflow plan approval ahead of legacy project policy", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-run-once-approval-"),
  );
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      workflow: {
        specApproval: { required: true, approvedLabel: "spec-ok" },
        planApproval: { required: false, approvedLabel: "plan-ok" },
      },
      projectPolicy: { planRequiresApproval: true },
    }),
    "utf8",
  );

  const config = await loadCliConfig(["--dry-run"], repoRoot, {});

  assert.equal(config.approvalPolicy.specApproval.required, true);
  assert.equal(config.approvalPolicy.specApproval.approvedLabel, "spec-ok");
  assert.equal(config.approvalPolicy.planApproval.required, false);
  assert.equal(config.approvalPolicy.planApproval.approvedLabel, "plan-ok");
});

test("loadCliConfig ignores removed legacy tea login when patchmill config only customizes paths", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      paths: {
        plansDir: "pm-plans",
        runStateDir: ".patchmill/runs",
        triageLogDir: ".patchmill/triage-runs",
        worktreeDir: ".patchmill/worktrees",
      },
    }),
  );

  const config = await loadCliConfig(["--dry-run"], repoRoot, {
    [LEGACY_RUN_ONCE_LOGIN_ENV]: "issue-agent",
  });

  assert.equal(config.teaLogin, "triage-agent");
  assert.equal(config.runStateDir, join(repoRoot, ".patchmill/runs"));
  assert.equal(config.worktreeDir, join(repoRoot, ".patchmill/worktrees"));
});

test("loadCliConfig lets run-once login flags override patchmill config", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      host: { login: "config-bot" },
    }),
  );

  const hostLogin = await loadCliConfig(
    ["--dry-run", "--host-login", "host-bot"],
    repoRoot,
    {},
  );
  const teaLogin = await loadCliConfig(
    ["--dry-run", "--tea-login", "tea-bot"],
    repoRoot,
    {},
  );

  assert.equal(hostLogin.teaLogin, "host-bot");
  assert.equal(teaLogin.teaLogin, "tea-bot");
});

test("loadCliConfig shows help without reading malformed patchmill config", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    "{not valid json",
    "utf8",
  );

  const helpLong = await loadCliConfig(["--help"], repoRoot, {});
  const helpShort = await loadCliConfig(["-h"], repoRoot, {});

  assert.equal(helpLong.showHelp, true);
  assert.equal(helpShort.showHelp, true);
});

test("parseArgs accepts dry-run mode", () => {
  const config = parseArgs(["--dry-run"], "/repo");

  assert.equal(config.dryRun, true);
  assert.equal(config.execute, false);
});

test("parseArgs rejects invalid issue numbers", () => {
  assert.throws(
    () => parseArgs(["--issue", "0"], "/repo"),
    /--issue must be a positive integer/,
  );

  assert.throws(
    () => parseArgs(["--issue", "abc"], "/repo"),
    /--issue must be a positive integer/,
  );
});

test("parseArgs rejects unknown arguments", () => {
  assert.throws(
    () => parseArgs(["--unknown"], "/repo"),
    /Unknown argument: --unknown/,
  );
});
