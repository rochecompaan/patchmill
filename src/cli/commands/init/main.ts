#!/usr/bin/env node
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./args.ts";
import { writeInitialConfig } from "./config-writer.ts";

export const HELP_TEXT = `Usage:
  patchmill init [options]

Create a minimal patchmill.config.json for this repository.

Options:
  --help, -h  Show this help and exit.
`;

export type InitOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

const DEFAULT_OUTPUT: InitOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

export async function runInit(
  args: string[],
  repoRoot = cwd(),
  output: InitOutput = DEFAULT_OUTPUT,
): Promise<number> {
  const config = parseArgs(args, repoRoot);
  if (config.showHelp) {
    output.stdout(HELP_TEXT);
    return 0;
  }

  const result = await writeInitialConfig(config.repoRoot, {});
  if (result.status === "exists") {
    output.stdout(
      `patchmill.config.json already exists.\n\nPatchmill did not overwrite it.\n\nNext:\n  patchmill doctor`,
    );
    return 1;
  }

  output.stdout(
    `Created patchmill.config.json\n\nHost:\n  provider: ${result.config.host.provider}\n  login: ${result.config.host.login}\n\nUsing Patchmill defaults for labels, paths, skills, and git policy.\n\nNext:\n  patchmill doctor`,
  );
  return 0;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    return await runInit(args);
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
