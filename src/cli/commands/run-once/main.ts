#!/usr/bin/env node
import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import { loadPatchmillConfigState } from "../../../config/load.ts";
import { parseArgs } from "./args.ts";
import { AgentIssueConsoleProgressReporter } from "./console-progress.ts";
import { runOneIssue } from "./pipeline.ts";
import {
  JsonlProgressReporter,
  compositeProgressReporter,
  runLogPath,
} from "./progress.ts";
import { createCommandRunner } from "../triage/command.ts";
import { detectDefaultBaseBranch } from "./git.ts";
import { appendPiErrorCause, formatErrorWithCauses } from "./pi-errors.ts";
import { summarizeErrorResult, summarizeResult } from "./result-summary.ts";
import {
  exitCodeForRunOnceResult,
  writeRunOnceResult,
} from "./result-output.ts";
import type { WriteRunOnceResultOptions } from "./result-output.ts";
import type { AgentIssuePipelineResult, CommandRunner } from "./types.ts";

export { summarizeResult } from "./result-summary.ts";

export const HELP_TEXT = `Usage:
  patchmill run-once [options]
  npm run run-once -- [options]

Advance one actionable issue through spec, plan, or implementation workflow states.
Claims and processes one eligible issue by default.
Use --dry-run to preview the next eligible issue without mutating the configured issue host or git.
Progress is written to stderr by default. Interactive stdout ends with a readable formatted result; redirected stdout remains compact JSON.
--quiet suppresses progress but not the final result. NO_COLOR disables result styling without changing output mode.
Run logs are written under the configured run state directory (default: .patchmill/runs/) and end with a structured result event.

Options:
  --help, -h          Show this help and exit.
  --dry-run, --dryrun Preview the next actionable issue without mutations.
  --plan-only         Run spec and plan stages as needed, then stop before implementation.
  --quiet             Suppress terminal progress; still write JSONL run log.
  --verbose-pi-output Stream raw Pi assistant/tool text in addition to concise progress.
  --issue <number>    Process one specific open actionable issue.
  --host-login <name> Use a named host login when the provider supports named logins.
  --tea-login <name>  Compatibility alias for --host-login.

Environment:
  PATCHMILL_HOST_LOGIN               Override the default host login name when supported.
`;

type Env = Record<string, string | undefined>;

function isHelpOnlyInvocation(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function issueNumberFromResult(
  result: AgentIssuePipelineResult,
): number | undefined {
  return "issue" in result ? result.issue.number : undefined;
}

export async function finalLogPath(
  preliminaryLogPath: string,
  runStateDir: string,
  timestamp: string,
  result: AgentIssuePipelineResult,
): Promise<string> {
  const issueNumber = issueNumberFromResult(result);
  if (issueNumber === undefined) return preliminaryLogPath;

  const issueLogPath = runLogPath(runStateDir, timestamp, issueNumber);
  if (issueLogPath === preliminaryLogPath) return preliminaryLogPath;

  await mkdir(dirname(issueLogPath), { recursive: true });
  await rename(preliminaryLogPath, issueLogPath);
  return issueLogPath;
}

export async function writePipelineFailureResult(
  error: unknown,
  logPath: string,
  options: Omit<WriteRunOnceResultOptions, "logPath">,
): Promise<0 | 1> {
  const summary = summarizeErrorResult(error, logPath);
  try {
    await writeRunOnceResult(summary, { ...options, logPath });
  } catch (reportingError) {
    throw appendPiErrorCause(error, "result reporting", reportingError);
  }
  return exitCodeForRunOnceResult(summary);
}

async function resolveRunOnceConfigBaseBranch(
  patchmillConfig: Awaited<
    ReturnType<typeof loadPatchmillConfigState>
  >["config"],
  explicitGitBaseBranch: boolean,
  runner: CommandRunner,
  repoRoot: string,
): Promise<typeof patchmillConfig> {
  if (explicitGitBaseBranch) return patchmillConfig;

  const detection = await detectDefaultBaseBranch(
    runner,
    repoRoot,
    patchmillConfig.git.remote,
    patchmillConfig.git.baseBranch,
  );
  return {
    ...patchmillConfig,
    git: { ...patchmillConfig.git, baseBranch: detection.branch },
  };
}

export async function loadCliConfig(
  args: string[],
  repoRoot = cwd(),
  env: Env = process.env,
  runner: CommandRunner = createCommandRunner(),
) {
  if (isHelpOnlyInvocation(args)) {
    return parseArgs(args, repoRoot, env);
  }

  const { config: patchmillConfig, explicitConfig } =
    await loadPatchmillConfigState(repoRoot, env, args);
  const runOnceConfig = await resolveRunOnceConfigBaseBranch(
    patchmillConfig,
    explicitConfig.gitBaseBranch,
    runner,
    repoRoot,
  );
  return parseArgs(args, repoRoot, env, runOnceConfig);
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const startedAt = new Date();
  const timestamp = startedAt.toISOString();

  try {
    const config = await loadCliConfig(args);
    if (config.showHelp) {
      console.log(HELP_TEXT);
      return 0;
    }

    const logPath = runLogPath(config.runStateDir, timestamp);
    const interactiveOutput = process.stdout.isTTY === true;
    const consoleProgress = config.quiet
      ? undefined
      : new AgentIssueConsoleProgressReporter({
          startedAt,
          deferFinalResult: interactiveOutput,
        });
    const progress = compositeProgressReporter([
      new JsonlProgressReporter(logPath),
      ...(consoleProgress ? [consoleProgress] : []),
    ]);

    let result: AgentIssuePipelineResult;
    try {
      result = await runOneIssue(createCommandRunner(), config, {
        now: startedAt,
        progress,
        logPath,
        verbosePiOutput: config.verbosePiOutput,
        streamPiOutput:
          !config.quiet && config.verbosePiOutput
            ? (chunk) => {
                process.stderr.write(chunk);
              }
            : undefined,
      });
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
        stdout: process.stdout,
        env: process.env,
        elapsedSeconds: Math.max(
          0,
          Math.round((Date.now() - startedAt.getTime()) / 1000),
        ),
      });
    }

    const outputLogPath = await finalLogPath(
      logPath,
      config.runStateDir,
      timestamp,
      result,
    );
    const summary = summarizeResult({ ...result, logPath: outputLogPath });
    await writeRunOnceResult(summary, {
      stdout: process.stdout,
      env: process.env,
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
    await writeRunOnceResult(summary, {
      stdout: process.stdout,
      env: process.env,
    });
    return exitCodeForRunOnceResult(summary);
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  process.exitCode = await main();
}
