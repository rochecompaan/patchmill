import { loadConfig } from "../../../config/config.ts";
import { createHost } from "../../../host/factory.ts";
import { runTriage, type TriageOptions } from "../../../kernel/triage.ts";
import { runCommand, type CommandRunner } from "../../../process/command.ts";
import type { CliOutput } from "../../main.ts";
import { resolveBundledPiCommand } from "../../pi-cli.ts";

const HELP = `Usage: patchmill triage [--issue N] [--dry-run]
Classify candidate issues. Use --issue to triage any issue.
Use --dry-run to print the label and comment without applying them.`;

type Options = {
  runner?: CommandRunner;
  output?: CliOutput;
  repoRoot?: string;
  runTriage?: typeof runTriage;
};

function parseArgs(args: string[]): TriageOptions {
  const options: TriageOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--issue") {
      const value = args[++i];
      if (
        options.issue !== undefined ||
        !/^[1-9]\d*$/.test(value ?? "") ||
        !Number.isSafeInteger(Number(value))
      )
        throw new Error("Use --issue N with a positive integer issue number.");
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
    const host = createHost(config, options.runner ?? runCommand, repoRoot);
    const check = await host.checkCli();
    if (!check.ok) throw new Error(check.message);
    const deps = {
      host,
      piCommand: resolveBundledPiCommand(),
      repoRoot,
      now: () => new Date(),
      output,
    };
    process.on("SIGINT", abort);
    process.on("SIGTERM", abort);
    await (options.runTriage ?? runTriage)(config, deps, {
      ...runOptions,
      signal: controller.signal,
    });
    return 0;
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}
