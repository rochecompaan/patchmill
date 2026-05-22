import test from "node:test";
import assert from "node:assert/strict";
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

test("parseArgs reads the default tea login from the environment", () => {
  const config = parseArgs(["--dry-run"], "/repo", { CROPRUN_TRIAGE_TEA_LOGIN: "triage-agent" });

  assert.equal(config.teaLogin, "triage-agent");
});

test("parseArgs defaults to the triage-agent tea login", () => {
  const config = parseArgs(["--dry-run"], "/repo", {});

  assert.equal(config.teaLogin, "triage-agent");
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
