#!/usr/bin/env node
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import { createCommandRunner } from "../triage/command.ts";
import { parseArgs } from "./args.ts";
import { runDoctorChecks, type DoctorCheckResult } from "./checks.ts";
import { formatDoctorReport, hasDoctorFailures } from "./reporting.ts";
import type { CommandRunner } from "../triage/types.ts";

export const HELP_TEXT = `Usage:
  patchmill doctor [options]

Run read-only checks for Patchmill repository readiness.

Options:
  --help, -h  Show this help and exit.
  --quiet     Suppress successful checklist output; failures still print.
`;

export type DoctorOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

const DEFAULT_OUTPUT: DoctorOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

export async function runDoctor(
  args: string[],
  repoRoot = cwd(),
  output: DoctorOutput = DEFAULT_OUTPUT,
  options: {
    runner?: CommandRunner;
    runChecks?: (
      runner: CommandRunner,
      options: { repoRoot: string },
    ) => Promise<DoctorCheckResult[]>;
  } = {},
): Promise<number> {
  const config = parseArgs(args, repoRoot);
  if (config.showHelp) {
    output.stdout(HELP_TEXT);
    return 0;
  }

  const runner = options.runner ?? createCommandRunner();
  const results = await (options.runChecks ?? runDoctorChecks)(runner, {
    repoRoot: config.repoRoot,
  });
  const failed = hasDoctorFailures(results);
  if (!config.quiet || failed) {
    output.stdout(formatDoctorReport(results).join("\n"));
  }
  return failed ? 1 : 0;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    return await runDoctor(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  process.exitCode = await main();
}
