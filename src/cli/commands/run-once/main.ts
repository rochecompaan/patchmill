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
import { summarizeResult } from "./result-summary.ts";
import type { AgentIssuePipelineResult, CommandRunner } from "./types.ts";

export { summarizeResult } from "./result-summary.ts";

export const HELP_TEXT = `Usage:
  patchmill run-once [options]
  npm run run-once -- [options]

Advance one actionable issue through spec, plan, or implementation workflow states.
Claims and processes one eligible issue by default.
Use --dry-run to preview the next eligible issue without mutating the configured issue host or git.
Progress is written to stderr by default. Final JSON is written to stdout.
Run logs are written under the configured run state directory (default: .patchmill/runs/).

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

async function finalLogPath(
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
  await rename(preliminaryLogPath, issueLogPath).catch(() => undefined);
  return issueLogPath;
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
    const progress = compositeProgressReporter([
      new JsonlProgressReporter(logPath),
      ...(config.quiet
        ? []
        : [new AgentIssueConsoleProgressReporter({ startedAt })]),
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
      const terminalFormatted = formatErrorWithCauses(terminalError);
      console.log(
        JSON.stringify({
          status: "error",
          error: terminalFormatted.message,
          ...(terminalFormatted.causes
            ? { causes: terminalFormatted.causes }
            : {}),
          logPath,
        }),
      );
      return 1;
    }

    const outputLogPath = await finalLogPath(
      logPath,
      config.runStateDir,
      timestamp,
      result,
    );
    console.log(
      JSON.stringify(summarizeResult({ ...result, logPath: outputLogPath })),
    );
    return result.status === "blocked" ||
      result.status === "approval-required" ||
      result.status === "development-environment-not-ready"
      ? 1
      : 0;
  } catch (error) {
    const formatted = formatErrorWithCauses(error);
    console.log(
      JSON.stringify({
        status: "error",
        error: formatted.message,
        ...(formatted.causes ? { causes: formatted.causes } : {}),
      }),
    );
    return 1;
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  process.exitCode = await main();
}
