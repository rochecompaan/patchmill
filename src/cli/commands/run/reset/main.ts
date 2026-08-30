import { createCommandRunner } from "../../triage/command.ts";
import { loadCliConfig } from "../../run-once/main.ts";
import { summarizeResult } from "../../run-once/result-summary.ts";
import {
  exitCodeForRunOnceResult,
  writeRunOnceResult,
} from "../../run-once/result-output.ts";
import { ResetIssueRunRecoveryError, resetIssueRun } from "./reset.ts";
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
  const stderr = dependencies.stderr ?? process.stderr;
  let result;
  try {
    result = await (dependencies.executeReset ?? resetIssueRun)(
      dependencies.runner ?? createCommandRunner(),
      config as typeof config & { issueNumber: number },
      { now: dependencies.now?.() ?? new Date() },
    );
  } catch (error) {
    if (error instanceof ResetIssueRunRecoveryError) {
      const mutation = error.cause;
      stderr.write(
        `Reset recovery failed: ${mutation instanceof Error ? mutation.message : String(mutation)}\nArchive: ${error.archivePath}\n${mutation instanceof Error && "quarantinePaths" in mutation ? (mutation.quarantinePaths as string[]).map((path) => `Preserved: ${path}`).join("\n") : ""}\n`,
      );
      return 1;
    }
    throw error;
  }
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
