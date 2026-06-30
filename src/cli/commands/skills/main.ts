#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  updateProjectSkills as defaultUpdateProjectSkills,
  type SkillPackUpdateOptions,
  type SkillPackUpdateResult,
} from "./update.ts";

export const HELP_TEXT = `Usage:
  patchmill skills update

Manage Patchmill project-local skills.

Commands:
  update  Update Patchmill-managed project-local skills.
`;

export type SkillsCommandOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type SkillsCommandOptions = {
  repoRoot?: string;
  output?: SkillsCommandOutput;
  updateProjectSkills?: (
    options: SkillPackUpdateOptions,
  ) => Promise<SkillPackUpdateResult>;
};

const DEFAULT_OUTPUT: SkillsCommandOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

function isHelp(arg: string | undefined): boolean {
  return !arg || arg === "--help" || arg === "-h" || arg === "help";
}

function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function printUpdateResult(
  output: SkillsCommandOutput,
  result: SkillPackUpdateResult,
): void {
  if (result.status === "up-to-date") {
    output.stdout("Patchmill skill pack is already up to date.");
    return;
  }

  output.stdout(
    `Updated Patchmill skill pack ${result.fromVersion} -> ${result.toVersion}.`,
  );
  output.stdout(
    `Updated ${formatCount(result.updatedFiles, "file")}, removed ${formatCount(
      result.removedFiles,
      "obsolete file",
    )}.`,
  );
  output.stdout("Run git diff to review changes.");
}

export async function runSkills(
  args: string[],
  options: SkillsCommandOptions = {},
): Promise<number> {
  const output = options.output ?? DEFAULT_OUTPUT;
  const subcommand = args[0];
  if (isHelp(subcommand)) {
    output.stdout(HELP_TEXT);
    return 0;
  }

  if (subcommand !== "update") {
    output.stderr(`Unknown skills command: ${subcommand}`);
    output.stderr(HELP_TEXT);
    return 1;
  }

  if (args.length > 1) {
    throw new Error("patchmill skills update does not accept arguments");
  }

  const updateProjectSkills =
    options.updateProjectSkills ?? defaultUpdateProjectSkills;
  const result = await updateProjectSkills({
    repoRoot: options.repoRoot ?? process.cwd(),
  });
  printUpdateResult(output, result);
  return 0;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    return await runSkills(args);
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
