import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { DEFAULT_PATCHMILL_POLICY } from "../../../policy/defaults.ts";
import {
  LEGACY_TRIAGE_LOGIN_ENV,
  literalPattern,
} from "../../../../test-support/legacy-seed.ts";
import { HELP_TEXT, loadCliConfig } from "./main.ts";
import { parseArgs } from "./args.ts";

test("parseArgs shows help when no args are provided", () => {
  const config = parseArgs([], "/repo");

  assert.equal(config.showHelp, true);
  assert.equal(config.dryRun, false);
  assert.equal(config.execute, true);
  assert.equal(config.repoRoot, "/repo");
  assert.equal(config.issueNumber, undefined);
  assert.equal(config.limit, undefined);
  assert.equal(config.teaLogin, "triage-agent");
  assert.equal(config.triageThinking, "high");
  assert.equal(config.logDir, "/repo/.patchmill/triage-runs");
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

test("parseArgs carries normalized host config", () => {
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

test("parseArgs accepts all to re-triage already classified issues", () => {
  const config = parseArgs(["--dry-run", "--all"], "/repo");

  assert.equal(config.all, true);
});

test("parseArgs executes by default for issue, limit, and log dir", () => {
  const config = parseArgs(
    [
      "--issue",
      "42",
      "--limit",
      "5",
      "--log-dir",
      "/tmp/triage-logs",
      "--tea-login",
      "triage-agent",
    ],
    "/repo",
  );

  assert.equal(config.showHelp, false);
  assert.equal(config.dryRun, false);
  assert.equal(config.execute, true);
  assert.equal(config.issueNumber, 42);
  assert.equal(config.limit, 5);
  assert.equal(config.logDir, "/tmp/triage-logs");
  assert.equal(config.teaLogin, "triage-agent");
  assert.equal(config.triageThinking, "high");
});

test("parseArgs accepts host-login as the primary tea login flag", () => {
  const config = parseArgs(
    ["--dry-run", "--host-login", "triage-agent"],
    "/repo",
  );

  assert.equal(config.teaLogin, "triage-agent");
});

test("parseArgs ignores removed legacy triage login variable", () => {
  const config = parseArgs(["--dry-run"], "/repo", {
    [LEGACY_TRIAGE_LOGIN_ENV]: "legacy-bot",
  });

  assert.equal(config.teaLogin, "triage-agent");
});

test("parseArgs prefers replacement host login env var", () => {
  const config = parseArgs(["--dry-run"], "/repo", {
    PATCHMILL_HOST_LOGIN: "patchmill-bot",
  });

  assert.equal(config.teaLogin, "patchmill-bot");
});

test("parseArgs defaults to the triage-agent tea login", () => {
  const config = parseArgs(["--dry-run"], "/repo", {});

  assert.equal(config.teaLogin, "triage-agent");
});

test("HELP_TEXT documents host-neutral host-login and tea-login flags", () => {
  assert.match(HELP_TEXT, /--host-login <name>/);
  assert.match(
    HELP_TEXT,
    /Use a named host login when the provider supports named logins/,
  );
  assert.match(HELP_TEXT, /--tea-login <name>/);
  assert.match(HELP_TEXT, /Compatibility alias for --host-login/);
  assert.match(HELP_TEXT, /PATCHMILL_HOST_LOGIN/);
  assert.doesNotMatch(HELP_TEXT, /Forgejo issue updates/);
  assert.doesNotMatch(HELP_TEXT, literalPattern(LEGACY_TRIAGE_LOGIN_ENV));
});

test("loadCliConfig uses normalized Patchmill triage defaults without config file", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-args-"));

  const config = await loadCliConfig(["--dry-run"], repoRoot, {
    [LEGACY_TRIAGE_LOGIN_ENV]: "legacy-bot",
  });

  assert.equal(config.teaLogin, "triage-agent");
  assert.equal(config.logDir, join(repoRoot, ".patchmill", "triage-runs"));
  assert.deepEqual(config.projectPolicy, DEFAULT_PATCHMILL_POLICY);
});

test("loadCliConfig applies normalized patchmill defaults for triage", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-config-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      host: { login: "config-bot" },
      pi: { triageThinking: "medium" },
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
    }),
  );

  const config = await loadCliConfig(["--dry-run"], repoRoot, {
    [LEGACY_TRIAGE_LOGIN_ENV]: "compat-bot",
  });

  assert.equal(config.teaLogin, "config-bot");
  assert.equal(config.logDir, join(repoRoot, ".patchmill/triage-runs"));
  assert.equal(config.triageThinking, "medium");
  assert.equal(config.triagePolicy?.labels.ready, "ready-for-bots");
  assert.ok(
    config.triagePolicy?.allowedLabels.some(
      (label) => label.name === "incident",
    ),
  );
  assert.deepEqual(config.triagePolicy?.excludedLabels, [
    "ready-for-bots",
    "needs-clarification",
    "manual-only",
    "in-progress",
    "agent-done",
    "blocked",
  ]);
  assert.deepEqual(config.triagePolicy?.runOnceSelection, {
    readyLabel: "ready-for-bots",
    excludedLabels: [
      "needs-clarification",
      "manual-only",
      "in-progress",
      "agent-done",
      "blocked",
    ],
    priorityOrder: ["priority:p1", "priority:p2"],
  });
});

test("loadCliConfig includes custom triage state aliases in triage policy", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-config-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify({
      labels: {
        ready: "ready-for-bots",
        needsInfo: "needs-clarification",
        unsuitable: "manual-only",
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
});

test("loadCliConfig ignores removed legacy tea login when patchmill config only customizes paths", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-config-"));
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
    [LEGACY_TRIAGE_LOGIN_ENV]: "compat-bot",
  });

  assert.equal(config.teaLogin, "triage-agent");
  assert.equal(config.logDir, join(repoRoot, ".patchmill/triage-runs"));
});

test("loadCliConfig lets triage login flags override patchmill config", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-config-"));
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
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-triage-config-"));
  await writeFile(
    join(repoRoot, "patchmill.config.json"),
    "{not valid json",
    "utf8",
  );

  const noArgs = await loadCliConfig([], repoRoot, {});
  const helpLong = await loadCliConfig(["--help"], repoRoot, {});
  const helpShort = await loadCliConfig(["-h"], repoRoot, {});

  assert.equal(noArgs.showHelp, true);
  assert.equal(helpLong.showHelp, true);
  assert.equal(helpShort.showHelp, true);
});

test("parseArgs rejects removed execute flag", () => {
  assert.throws(
    () => parseArgs(["--execute"], "/repo"),
    /Unknown argument: --execute/,
  );
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
