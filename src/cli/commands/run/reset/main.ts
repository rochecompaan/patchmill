import { createCommandRunner } from "../../triage/command.ts";
import {
  finalLogPath,
  loadCliConfig,
  writePipelineFailureResult,
} from "../../run-once/main.ts";
import { AgentIssueConsoleProgressReporter } from "../../run-once/console-progress.ts";
import {
  JsonlProgressReporter,
  compositeProgressReporter,
  runLogPath,
} from "../../run-once/progress.ts";
import {
  appendPiErrorCause,
  formatErrorWithCauses,
} from "../../run-once/pi-errors.ts";
import {
  summarizeErrorResult,
  summarizeResult,
} from "../../run-once/result-summary.ts";
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
  const startedAt = dependencies.now?.() ?? new Date();
  const timestamp = startedAt.toISOString();
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const env = dependencies.env ?? process.env;
  try {
    const runner = dependencies.runner ?? createCommandRunner();
    const config = await (dependencies.loadConfig ?? loadCliConfig)(
      args,
      undefined,
      env,
      runner,
    );
    if (!config.issueNumber)
      throw new Error("patchmill run reset requires --issue <number>");
    if (config.dryRun)
      throw new Error(
        "patchmill run reset rejects --dry-run: no reset preview contract exists",
      );

    const logPath = runLogPath(config.runStateDir, timestamp);
    const interactiveOutput = stdout.isTTY === true;
    const consoleProgress = config.quiet
      ? undefined
      : new AgentIssueConsoleProgressReporter({
          startedAt,
          deferFinalResult: interactiveOutput,
          write: (chunk) => stderr.write(chunk),
        });
    const progress = compositeProgressReporter([
      new JsonlProgressReporter(logPath),
      ...(consoleProgress ? [consoleProgress] : []),
    ]);
    let result;
    try {
      result = await (dependencies.executeReset ?? resetIssueRun)(
        runner,
        config as typeof config & { issueNumber: number },
        {
          now: startedAt,
          progress,
          logPath,
          verbosePiOutput: config.verbosePiOutput,
          streamPiOutput:
            !config.quiet && config.verbosePiOutput
              ? (chunk) => stderr.write(chunk)
              : undefined,
        },
      );
      if (result.status === "nothing-to-reset")
        throw new Error(result.guidance);
    } catch (error) {
      const formatted = formatErrorWithCauses(error);
      let terminalError = error;
      try {
        await progress.event({
          time: new Date().toISOString(),
          level: "error",
          stage: "error",
          message: `blocked: ${formatted.message}`,
          data: { error: formatted.message, causes: formatted.causes },
        });
      } catch (reportingError) {
        terminalError = appendPiErrorCause(
          error,
          "error reporting",
          reportingError,
        );
      }
      return writePipelineFailureResult(terminalError, logPath, {
        stdout,
        env,
        elapsedSeconds: Math.max(
          0,
          Math.round((Date.now() - startedAt.getTime()) / 1000),
        ),
      });
    }

    await progress.event({
      time: new Date().toISOString(),
      level: "info",
      stage: "recovery",
      message: `Recovery action: ${result.recoveryAction}`,
      data: { archivePath: result.archivePath },
    });
    const outputLogPath = await finalLogPath(
      logPath,
      config.runStateDir,
      timestamp,
      result.pipelineResult,
    );
    const summary = summarizeResult({
      ...result.pipelineResult,
      logPath: outputLogPath,
    });
    await writeRunOnceResult(summary, {
      stdout,
      env,
      logPath: outputLogPath,
      progress: consoleProgress?.finalResultSnapshot(),
      elapsedSeconds: Math.max(
        0,
        Math.round((Date.now() - startedAt.getTime()) / 1000),
      ),
    });
    return exitCodeForRunOnceResult(summary);
  } catch (error) {
    const summary = summarizeErrorResult(error);
    await writeRunOnceResult(summary, { stdout, env });
    return exitCodeForRunOnceResult(summary);
  }
}
export const main = runResetCommand;
