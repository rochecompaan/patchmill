import { resolve } from "node:path";
import { loadConfig } from "../../../config/config.ts";
import { createHost } from "../../../host/factory.ts";
import { acquireLock, LockHeldError } from "../../../kernel/lock.ts";
import { runCommand, type CommandRunner } from "../../../process/command.ts";
import type { CliOutput } from "../../main.ts";

const HELP = `Usage: patchmill release --issue N
Reset an issue from in-progress to ready when no Run attempt is active.`;

type Options = {
  runner?: CommandRunner;
  output?: CliOutput;
  repoRoot?: string;
};

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
  if (
    args.length !== 2 ||
    args[0] !== "--issue" ||
    !/^[1-9]\d*$/.test(args[1]!) ||
    !Number.isSafeInteger(Number(args[1]))
  ) {
    output.stderr("Use --issue N with a positive integer issue number.");
    output.stderr(HELP);
    return 1;
  }
  try {
    const issueNumber = Number(args[1]);
    const repoRoot = options.repoRoot ?? process.cwd();
    const config = await loadConfig(repoRoot);
    const lock = await acquireLock(
      resolve(repoRoot, config.paths.runsDir, `issue-${issueNumber}`, "lock"),
    );
    try {
      const host = createHost(config, options.runner ?? runCommand, repoRoot);
      const issue = await host.viewIssue(issueNumber);
      const { ready, inProgress } = config.labels;
      if (!issue.labels.includes(inProgress)) {
        output.stdout(`Issue #${issueNumber}: nothing to release.`);
      } else {
        await host.setLabels(issueNumber, [ready], [inProgress]);
        output.stdout(`Issue #${issueNumber}: ${inProgress} -> ${ready}.`);
      }
    } finally {
      await lock.release();
    }
    return 0;
  } catch (error) {
    output.stderr(
      error instanceof LockHeldError
        ? "Run attempt is active"
        : error instanceof Error
          ? error.message
          : String(error),
    );
    return 1;
  }
}
