#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HELP_TEXT = `Usage:
  patchmill <command> [options]

Commands:
  triage      Classify repository issues for agent readiness.
  run-once    Claim and process one agent-ready issue.

Examples:
  patchmill triage --dry-run
  patchmill triage --execute --limit 5
  patchmill run-once --dry-run
  patchmill run-once --execute --agent-team openai-only

Patchmill is currently bootstrapped from the Croprun Forgejo + Pi workflow.
Generalization work is tracked in docs/specs and docs/plans.
`;

const command = process.argv[2];
const args = process.argv.slice(3);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const scripts: Record<string, string> = {
  triage: join(root, "scripts", "agent-issue-triage.ts"),
  "run-once": join(root, "scripts", "agent-issue-once.ts"),
};

if (!command || command === "--help" || command === "-h" || command === "help") {
  console.log(HELP_TEXT);
  process.exit(0);
}

const script = scripts[command];
if (!script) {
  console.error(`Unknown command: ${command}`);
  console.error(HELP_TEXT);
  process.exit(1);
}

const result = spawnSync(process.execPath, [script, ...args], {
  cwd: process.cwd(),
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.signal) {
  console.error(`patchmill ${command} terminated by ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
