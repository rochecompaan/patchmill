import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { cwd } from "node:process";
import { join } from "node:path";
import { HELP_TEXT, loadCliConfig, summarizeResult } from "../agent-issue-once.ts";
import { parseArgs } from "./args.ts";

test("parseArgs shows help when no args are provided", () => {
  const config = parseArgs([], cwd(), {});

  assert.equal(config.showHelp, true);
  assert.equal(config.repoRoot, cwd());
  assert.equal(config.dryRun, true);
  assert.equal(config.execute, false);
  assert.equal(config.issueNumber, undefined);
  assert.equal(config.planOnly, false);
  assert.equal(config.teaLogin, "triage-agent");
  assert.equal(config.plansDir, join(cwd(), "docs", "plans"));
  assert.equal(config.runStateDir, join(cwd(), ".pi", "agent-issue", "runs"));
  assert.equal(config.worktreeDir, join(cwd(), ".worktrees"));
  assert.deepEqual(config.cleanStatusIgnorePrefixes, [".patchmill/runs/", ".patchmill/triage-runs/", ".pi/agent-issue/runs/"]);
  assert.equal(config.readyLabel, "agent-ready");
  assert.equal(config.issueLimit, 1);
  assert.equal(config.requirePlanApproval, false);
});

test("parseArgs shows help for help flags", () => {
  assert.equal(parseArgs(["--help"], "/repo", {}).showHelp, true);
  assert.equal(parseArgs(["-h"], "/repo", {}).showHelp, true);
});

test("parseArgs does not show help when an option is provided", () => {
  assert.equal(parseArgs(["--dry-run"], "/repo", {}).showHelp, false);
});

test("HELP_TEXT documents one-issue usage and options", () => {
  assert.match(HELP_TEXT, /Usage:/);
  assert.match(HELP_TEXT, /agent-issue-once/);
  assert.match(HELP_TEXT, /--help/);
  assert.match(HELP_TEXT, /--dry-run/);
  assert.match(HELP_TEXT, /--execute/);
  assert.match(HELP_TEXT, /--plan-only/);
  assert.match(HELP_TEXT, /--issue <number>/);
  assert.match(HELP_TEXT, /--host-login <name>/);
  assert.match(HELP_TEXT, /--tea-login <name>/);
  assert.match(HELP_TEXT, /--agent-team <name>/);
  assert.match(HELP_TEXT, /CROPRUN_AGENT_ISSUE_TEA_LOGIN/);
  assert.match(HELP_TEXT, /CROPRUN_AGENT_ISSUE_AGENT_TEAM/);
});

test("parseArgs accepts execute mode", () => {
  const config = parseArgs(["--execute"], "/repo");

  assert.equal(config.dryRun, false);
  assert.equal(config.execute, true);
});

test("parseArgs accepts quiet mode", () => {
  const config = parseArgs(["--quiet"], "/repo", {});

  assert.equal(config.quiet, true);
  assert.equal(config.showHelp, false);
});

test("parseArgs enables verbose Pi output", () => {
  const config = parseArgs(["--execute", "--verbose-pi-output"], "/repo", {});

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

test("help text documents Forgejo visual evidence upload environment", () => {
  assert.match(HELP_TEXT, /CROPRUN_AGENT_ISSUE_FORGEJO_URL/);
  assert.match(HELP_TEXT, /CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN/);
  assert.match(HELP_TEXT, /CROPRUN_AGENT_ISSUE_FORGEJO_REPO/);
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
      logPath: ".pi/agent-issue/runs/issue-42/run.jsonl",
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
      logPath: ".pi/agent-issue/runs/issue-42/run.jsonl",
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
    CROPRUN_AGENT_ISSUE_TEA_LOGIN: "issue-agent",
    CROPRUN_TRIAGE_TEA_LOGIN: "triage-agent",
  });

  assert.equal(config.teaLogin, "operator");
});

test("parseArgs accepts host-login as the primary tea login flag", () => {
  const config = parseArgs(["--host-login", "operator"], "/repo", {
    CROPRUN_AGENT_ISSUE_TEA_LOGIN: "issue-agent",
  });

  assert.equal(config.teaLogin, "operator");
});

test("parseArgs accepts an explicit agent team", () => {
  const config = parseArgs(["--agent-team", "economy"], "/repo", {
    CROPRUN_AGENT_ISSUE_AGENT_TEAM: "premium",
  });

  assert.equal(config.agentTeamName, "economy");
});

test("parseArgs reads agent team from CROPRUN_AGENT_ISSUE_AGENT_TEAM", () => {
  const config = parseArgs([], "/repo", {
    CROPRUN_AGENT_ISSUE_AGENT_TEAM: "economy",
  });

  assert.equal(config.agentTeamName, "economy");
});

test("parseArgs prefers PATCHMILL_AGENT_TEAM over Croprun agent team", () => {
  const config = parseArgs(["--dry-run"], "/repo", {
    PATCHMILL_AGENT_TEAM: "patchmill-team",
    CROPRUN_AGENT_ISSUE_AGENT_TEAM: "croprun-team",
  });
  assert.equal(config.agentTeamName, "patchmill-team");
});

test("parseArgs falls back to CROPRUN_AGENT_ISSUE_TEA_LOGIN when PATCHMILL_HOST_LOGIN is unset", () => {
  const config = parseArgs([], "/repo", {
    CROPRUN_AGENT_ISSUE_TEA_LOGIN: "issue-agent",
    CROPRUN_TRIAGE_TEA_LOGIN: "triage-agent",
  });

  assert.equal(config.teaLogin, "issue-agent");
});

test("parseArgs prefers PATCHMILL_HOST_LOGIN over Croprun tea login fallbacks", () => {
  const config = parseArgs([], "/repo", {
    PATCHMILL_HOST_LOGIN: "patchmill-bot",
    CROPRUN_AGENT_ISSUE_TEA_LOGIN: "issue-agent",
    CROPRUN_TRIAGE_TEA_LOGIN: "triage-agent",
  });

  assert.equal(config.teaLogin, "patchmill-bot");
});

test("parseArgs falls back to CROPRUN_TRIAGE_TEA_LOGIN", () => {
  const config = parseArgs([], "/repo", {
    CROPRUN_TRIAGE_TEA_LOGIN: "triage-agent",
  });

  assert.equal(config.teaLogin, "triage-agent");
});

test("loadCliConfig preserves Croprun compatibility defaults when no patchmill config file exists", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));

  const config = await loadCliConfig(["--dry-run"], repoRoot, {
    CROPRUN_AGENT_ISSUE_TEA_LOGIN: "issue-agent",
    CROPRUN_AGENT_ISSUE_AGENT_TEAM: "economy",
  });

  assert.equal(config.teaLogin, "issue-agent");
  assert.equal(config.agentTeamName, "economy");
  assert.equal(config.plansDir, join(repoRoot, "docs/plans"));
  assert.equal(config.runStateDir, join(repoRoot, ".pi/agent-issue/runs"));
  assert.equal(config.worktreeDir, join(repoRoot, ".worktrees"));
});

test("loadCliConfig applies normalized patchmill defaults for run-once", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));
  await writeFile(join(repoRoot, "patchmill.config.json"), JSON.stringify({
    host: { login: "config-bot" },
    pi: { team: "config-team" },
    paths: {
      plansDir: "pm-plans",
      runStateDir: ".patchmill/runs",
      triageLogDir: ".patchmill/triage-runs",
      worktreeDir: ".patchmill/worktrees",
      cleanStatusIgnorePrefixes: ["scratch/", ".patchmill/custom-runs/"],
    },
  }));

  const config = await loadCliConfig(["--dry-run"], repoRoot, {
    CROPRUN_AGENT_ISSUE_TEA_LOGIN: "issue-agent",
    CROPRUN_AGENT_ISSUE_AGENT_TEAM: "economy",
  });

  assert.equal(config.teaLogin, "config-bot");
  assert.equal(config.agentTeamName, "config-team");
  assert.equal(config.plansDir, join(repoRoot, "pm-plans"));
  assert.equal(config.runStateDir, join(repoRoot, ".patchmill/runs"));
  assert.equal(config.worktreeDir, join(repoRoot, ".patchmill/worktrees"));
  assert.deepEqual(config.cleanStatusIgnorePrefixes, ["scratch/", ".patchmill/custom-runs/"]);
});

test("loadCliConfig preserves Croprun tea login when patchmill config only customizes paths", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));
  await writeFile(join(repoRoot, "patchmill.config.json"), JSON.stringify({
    paths: {
      plansDir: "pm-plans",
      runStateDir: ".patchmill/runs",
      triageLogDir: ".patchmill/triage-runs",
      worktreeDir: ".patchmill/worktrees",
    },
  }));

  const config = await loadCliConfig(["--dry-run"], repoRoot, {
    CROPRUN_AGENT_ISSUE_TEA_LOGIN: "issue-agent",
  });

  assert.equal(config.teaLogin, "issue-agent");
  assert.equal(config.runStateDir, join(repoRoot, ".patchmill/runs"));
  assert.equal(config.worktreeDir, join(repoRoot, ".patchmill/worktrees"));
});

test("loadCliConfig lets run-once login and agent-team flags override patchmill config", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));
  await writeFile(join(repoRoot, "patchmill.config.json"), JSON.stringify({
    host: { login: "config-bot" },
    pi: { team: "config-team" },
  }));

  const hostLogin = await loadCliConfig(
    ["--dry-run", "--host-login", "host-bot", "--agent-team", "cli-team"],
    repoRoot,
    {},
  );
  const teaLogin = await loadCliConfig(
    ["--dry-run", "--tea-login", "tea-bot", "--agent-team", "legacy-team"],
    repoRoot,
    {},
  );

  assert.equal(hostLogin.teaLogin, "host-bot");
  assert.equal(hostLogin.agentTeamName, "cli-team");
  assert.equal(teaLogin.teaLogin, "tea-bot");
  assert.equal(teaLogin.agentTeamName, "legacy-team");
});

test("loadCliConfig shows help without reading malformed patchmill config", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-run-once-config-"));
  await writeFile(join(repoRoot, "patchmill.config.json"), "{not valid json", "utf8");

  const noArgs = await loadCliConfig([], repoRoot, {});
  const helpLong = await loadCliConfig(["--help"], repoRoot, {});
  const helpShort = await loadCliConfig(["-h"], repoRoot, {});

  assert.equal(noArgs.showHelp, true);
  assert.equal(helpLong.showHelp, true);
  assert.equal(helpShort.showHelp, true);
});

test("parseArgs accepts dry-run after execute", () => {
  const config = parseArgs(["--execute", "--dry-run"], "/repo");

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
