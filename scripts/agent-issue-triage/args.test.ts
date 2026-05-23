import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HELP_TEXT, loadCliConfig } from "../agent-issue-triage.ts";
import { parseArgs } from "./args.ts";

test("parseArgs shows help when no args are provided", () => {
  const config = parseArgs([], "/repo");

  assert.equal(config.showHelp, true);
  assert.equal(config.dryRun, true);
  assert.equal(config.execute, false);
  assert.equal(config.repoRoot, "/repo");
  assert.equal(config.issueNumber, undefined);
  assert.equal(config.limit, undefined);
  assert.equal(config.teaLogin, "triage-agent");
  assert.equal(config.logDir, "/repo/.pi/agent-issue/triage-runs");
});

test("parseArgs shows help for help flags", () => {
  assert.equal(parseArgs(["--help"], "/repo").showHelp, true);
  assert.equal(parseArgs(["-h"], "/repo").showHelp, true);
});

test("parseArgs accepts dryrun alias", () => {
  const config = parseArgs(["--dryrun"], "/repo");

  assert.equal(config.showHelp, false);
  assert.equal(config.dryRun, true);
  assert.equal(config.execute, false);
});

test("parseArgs accepts all to re-triage already classified issues", () => {
  const config = parseArgs(["--dry-run", "--all"], "/repo");

  assert.equal(config.all, true);
});

test("parseArgs accepts execute, issue, limit, and log dir", () => {
  const config = parseArgs([
    "--execute",
    "--issue", "42",
    "--limit", "5",
    "--log-dir", "/tmp/triage-logs",
    "--tea-login", "triage-agent",
  ], "/repo");

  assert.equal(config.dryRun, false);
  assert.equal(config.execute, true);
  assert.equal(config.issueNumber, 42);
  assert.equal(config.limit, 5);
  assert.equal(config.logDir, "/tmp/triage-logs");
  assert.equal(config.teaLogin, "triage-agent");
});

test("parseArgs accepts host-login as the primary tea login flag", () => {
  const config = parseArgs(["--dry-run", "--host-login", "triage-agent"], "/repo");

  assert.equal(config.teaLogin, "triage-agent");
});

test("parseArgs reads the default tea login from the environment", () => {
  const config = parseArgs(["--dry-run"], "/repo", { CROPRUN_TRIAGE_TEA_LOGIN: "triage-agent" });

  assert.equal(config.teaLogin, "triage-agent");
});

test("parseArgs prefers PATCHMILL_HOST_LOGIN over Croprun triage login", () => {
  const config = parseArgs(["--dry-run"], "/repo", {
    PATCHMILL_HOST_LOGIN: "patchmill-bot",
    CROPRUN_TRIAGE_TEA_LOGIN: "compat-bot",
  });
  assert.equal(config.teaLogin, "patchmill-bot");
});

test("parseArgs defaults to the triage-agent tea login", () => {
  const config = parseArgs(["--dry-run"], "/repo", {});

  assert.equal(config.teaLogin, "triage-agent");
});

test("HELP_TEXT documents host-login and tea-login flags", () => {
  assert.match(HELP_TEXT, /--host-login <name>/);
  assert.match(HELP_TEXT, /--tea-login <name>/);
});

test("loadCliConfig preserves Croprun tea login compatibility when no patchmill config file exists", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-config-"));

  const config = await loadCliConfig(["--dry-run"], repoRoot, {
    CROPRUN_TRIAGE_TEA_LOGIN: "compat-bot",
  });

  assert.equal(config.teaLogin, "compat-bot");
  assert.equal(config.logDir, join(repoRoot, ".pi/agent-issue/triage-runs"));
});

test("loadCliConfig applies normalized patchmill defaults for triage", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-config-"));
  await writeFile(join(repoRoot, "patchmill.config.json"), JSON.stringify({
    host: { login: "config-bot" },
    pi: { team: "config-team" },
    paths: {
      plansDir: "pm-plans",
      runStateDir: ".patchmill/runs",
      triageLogDir: ".patchmill/triage-runs",
      worktreeDir: ".patchmill/worktrees",
    },
    labels: {
      ready: "ready-for-bots",
      needsInfo: "needs-clarification",
      unsuitable: "manual-only",
      types: ["incident"],
      priorities: ["priority:p1", "priority:p2"],
    },
  }));

  const config = await loadCliConfig(["--dry-run"], repoRoot, {
    CROPRUN_TRIAGE_TEA_LOGIN: "compat-bot",
  });

  assert.equal(config.teaLogin, "config-bot");
  assert.equal(config.logDir, join(repoRoot, ".patchmill/triage-runs"));
  assert.equal(config.triagePolicy?.primaryBuckets[0]?.label, "ready-for-bots");
  assert.ok(config.triagePolicy?.triageAllowedLabels.some((label) => label.name === "incident"));
});

test("loadCliConfig preserves Croprun tea login when patchmill config only customizes paths", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-config-"));
  await writeFile(join(repoRoot, "patchmill.config.json"), JSON.stringify({
    paths: {
      plansDir: "pm-plans",
      runStateDir: ".patchmill/runs",
      triageLogDir: ".patchmill/triage-runs",
      worktreeDir: ".patchmill/worktrees",
    },
  }));

  const config = await loadCliConfig(["--dry-run"], repoRoot, {
    CROPRUN_TRIAGE_TEA_LOGIN: "compat-bot",
  });

  assert.equal(config.teaLogin, "compat-bot");
  assert.equal(config.logDir, join(repoRoot, ".patchmill/triage-runs"));
});

test("loadCliConfig lets triage login flags override patchmill config", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-config-"));
  await writeFile(join(repoRoot, "patchmill.config.json"), JSON.stringify({
    host: { login: "config-bot" },
  }));

  const hostLogin = await loadCliConfig(["--dry-run", "--host-login", "host-bot"], repoRoot, {});
  const teaLogin = await loadCliConfig(["--dry-run", "--tea-login", "tea-bot"], repoRoot, {});

  assert.equal(hostLogin.teaLogin, "host-bot");
  assert.equal(teaLogin.teaLogin, "tea-bot");
});

test("loadCliConfig shows help without reading malformed patchmill config", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-config-"));
  await writeFile(join(repoRoot, "patchmill.config.json"), "{not valid json", "utf8");

  const noArgs = await loadCliConfig([], repoRoot, {});
  const helpLong = await loadCliConfig(["--help"], repoRoot, {});
  const helpShort = await loadCliConfig(["-h"], repoRoot, {});

  assert.equal(noArgs.showHelp, true);
  assert.equal(helpLong.showHelp, true);
  assert.equal(helpShort.showHelp, true);
});

test("parseArgs accepts an explicit dry-run after execute", () => {
  const config = parseArgs(["--execute", "--dry-run"], "/repo");

  assert.equal(config.dryRun, true);
  assert.equal(config.execute, false);
});

test("parseArgs rejects invalid issue numbers", () => {
  assert.throws(
    () => parseArgs(["--issue", "abc"], "/repo"),
    /--issue must be a positive integer/,
  );
});

test("parseArgs rejects invalid limits", () => {
  assert.throws(
    () => parseArgs(["--limit", "0"], "/repo"),
    /--limit must be a positive integer/,
  );
});

test("parseArgs rejects unknown arguments", () => {
  assert.throws(
    () => parseArgs(["--unknown"], "/repo"),
    /Unknown argument: --unknown/,
  );
});
