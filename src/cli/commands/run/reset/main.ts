import { createCommandRunner } from "../../triage/command.ts";
import { loadCliConfig } from "../../run-once/main.ts";
import { summarizeResult } from "../../run-once/result-summary.ts";
import {
  exitCodeForRunOnceResult,
  writeRunOnceResult,
} from "../../run-once/result-output.ts";
import { resetIssueRun } from "./reset.ts";
export async function runResetCommand(
  args: string[],
  dependencies: Partial<{
    loadConfig: typeof loadCliConfig;
    executeReset: typeof resetIssueRun;
    runner: ReturnType<typeof createCommandRunner>;
    stdout: typeof process.stdout;
    stderr: Pick<NodeJS.WriteStream, "write">;
    env: Record<string, string | undefined>;
    now: () => Date;
  }> = {},
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    (dependencies.stdout ?? process.stdout).write(
      "Usage: patchmill run reset --issue <number> [run-once options]\n",
    );
    return 0;
  }
  const config = await (dependencies.loadConfig ?? loadCliConfig)(
    args,
    undefined,
    dependencies.env ?? process.env,
    dependencies.runner ?? createCommandRunner(),
  );
  if (!config.issueNumber)
    throw new Error("patchmill run reset requires --issue <number>");
  if (config.dryRun)
    throw new Error(
      "patchmill run reset rejects --dry-run: no reset preview contract exists",
    );
  const result = await (dependencies.executeReset ?? resetIssueRun)(
    dependencies.runner ?? createCommandRunner(),
    config as typeof config & { issueNumber: number },
    { now: dependencies.now?.() ?? new Date() },
  );
  const stderr = dependencies.stderr ?? process.stderr;
  if (result.status === "nothing-to-reset") {
    stderr.write(`${result.guidance}\n`);
    return 1;
  }
  stderr.write(
    `Recovery action: ${result.recoveryAction}\nArchive: ${result.archivePath}\n${result.quarantinePaths.map((path) => `Quarantine: ${path}`).join("\n")}\n`,
  );
  const summary = summarizeResult(result.pipelineResult);
  await writeRunOnceResult(summary, {
    stdout: dependencies.stdout ?? process.stdout,
    env: dependencies.env ?? process.env,
  });
  return exitCodeForRunOnceResult(summary);
}
export const main = runResetCommand;
