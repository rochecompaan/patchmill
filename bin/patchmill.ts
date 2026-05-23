#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HELP_TEXT = `Usage:
  patchmill <command> [options]

Commands:
  triage      Classify repository issues for agent readiness.
  run-once    Claim and process one agent-ready issue.
`;

export type ResolvedCommand = {
  script: string;
  args: string[];
};

const COMMAND_SCRIPTS = new Map<string, string>([
  ["triage", "agent-issue-triage.ts"],
  ["run-once", "agent-issue-once.ts"],
]);

export function resolveCommand(root: string, argv: string[]): ResolvedCommand | "help" {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h" || command === "help") return "help";

  const scriptName = COMMAND_SCRIPTS.get(command);
  if (!scriptName) throw new Error(`Unknown command: ${command}`);
  return { script: join(root, "scripts", scriptName), args: argv.slice(1) };
}

export function main(argv = process.argv.slice(2)): number {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  let resolved: ResolvedCommand | "help";
  try {
    resolved = resolveCommand(root, argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(HELP_TEXT);
    return 1;
  }

  if (resolved === "help") {
    console.log(HELP_TEXT);
    return 0;
  }

  const result = spawnSync(process.execPath, [resolved.script, ...resolved.args], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  if (result.signal) {
    console.error(`patchmill terminated by ${result.signal}`);
    return 1;
  }
  return result.status ?? 1;
}

function isMainModule(metaUrl: string, argv1 = process.argv[1]): boolean {
  if (!argv1) return false;

  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url)) process.exit(main());
