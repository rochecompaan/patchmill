import { loadConfig } from "../../../config/config.ts";
import { createHost } from "../../../host/factory.ts";
import { createKernelGit } from "../../../kernel/git.ts";
import { runOneIssue, type RunOnceOptions } from "../../../kernel/run-once.ts";
import { resolvePiSubagentsPackageRoot } from "../../../pi/pi-subagents-package.ts";
import { runCommand, type CommandRunner } from "../../../process/command.ts";
import type { CliOutput } from "../../main.ts";
import { resolveBundledPiCommand } from "../../pi-cli.ts";

const HELP = `Usage: patchmill run-once [--issue N] [--dry-run] [--plan-only]
Advance one issue. Use --dry-run to show the next phase without claiming it.
Use --plan-only to stop after planning.`;

type Options = {
  runner?: CommandRunner;
  output?: CliOutput;
  repoRoot?: string;
  runOneIssue?: typeof runOneIssue;
};

function parseArgs(args: string[]): RunOnceOptions {
  const options: RunOnceOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--plan-only") options.planOnly = true;
    else if (arg === "--issue") {
      const value = args[++i];
      if (
        options.issue !== undefined ||
        !/^[1-9]\d*$/.test(value ?? "") ||
        !Number.isSafeInteger(Number(value))
      ) {
        throw new Error("Use --issue N with a positive integer issue number.");
      }
      options.issue = Number(value);
    } else throw new Error(`Unknown argument: ${arg}. Use --help for options.`);
  }
  return options;
}

export async function main(
  args: string[] = process.argv.slice(2),
  options: Options = {},
): Promise<number> {
  const output = options.output ?? {
    stdout: console.log,
    stderr: console.error,
  };
  if (args.length === 1 && ["--help", "-h", "help"].includes(args[0]!)) {
    output.stdout(HELP);
    return 0;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  try {
    const runOptions = parseArgs(args);
    const repoRoot = options.repoRoot ?? process.cwd();
    const config = await loadConfig(repoRoot);
    const runner = options.runner ?? runCommand;
    const deps = {
      host: createHost(config, runner, repoRoot),
      runner,
      git: createKernelGit(runner, repoRoot),
      piCommand: resolveBundledPiCommand(),
      extensionPaths: [resolvePiSubagentsPackageRoot()],
      repoRoot,
      now: () => new Date(),
      output,
    };
    process.on("SIGINT", abort);
    process.on("SIGTERM", abort);
    const outcome = await (options.runOneIssue ?? runOneIssue)(config, deps, {
      ...runOptions,
      signal: controller.signal,
    });
    if (outcome.status === "refused") output.stderr(outcome.reason);
    if (outcome.status === "claimed-elsewhere")
      output.stderr(`Issue #${outcome.issue} was claimed elsewhere.`);
    // Publication errors leave remote labels or comments for an operator to fix.
    return outcome.status === "refused" ||
      outcome.status === "claimed-elsewhere" ||
      "publicationErrors" in outcome
      ? 1
      : 0;
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}
