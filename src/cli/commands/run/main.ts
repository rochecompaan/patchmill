import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../../../config/config.ts";
import { errorMessage } from "../../../kernel/errors.ts";
import { runOneIssue } from "../../../kernel/run-once.ts";
import {
  acquireLifetimeLock,
  LifetimeLockHeldError,
} from "../../../kernel/runner/lifetime-lock.ts";
import { localTriageGate } from "../../../kernel/runner/local-triage-gate.ts";
import { runRunnerShell } from "../../../kernel/runner/shell.ts";
import { stateTrackingMode } from "../../../kernel/state-tracking-mode.ts";
import { runTriage } from "../../../kernel/triage.ts";
import { runCommand, type CommandRunner } from "../../../process/command.ts";
import type { CliOutput } from "../../main.ts";
import { createRunOnceDeps } from "../run-once/deps.ts";
import { createTriageProgressReporter } from "../triage/progress-output.ts";

const HELP = `Usage: patchmill run
Triage and run issues one at a time until stopped.
Send SIGINT or SIGTERM once to stop after the active run pauses; send it
again to force an exit. Exit codes: 0 clean stop, 1 error, 2 another runner
owns this clone.`;

const PREFIX = "patchmill run:";
const SIGNALS = ["SIGINT", "SIGTERM"] as const;

type Options = {
  runner?: CommandRunner;
  output?: CliOutput;
  repoRoot?: string;
  now?: () => Date;
  runOneIssue?: typeof runOneIssue;
  runTriage?: typeof runTriage;
  runRunnerShell?: typeof runRunnerShell;
  acquireLifetimeLock?: typeof acquireLifetimeLock;
  stateTrackingMode?: typeof stateTrackingMode;
  exit?: (code: number) => void;
};

/** Resolves after `ms`, or at once when `signal` aborts. */
async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch (error) {
    if ((error as Error).name !== "AbortError") throw error;
  }
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
  if (args.length) {
    output.stderr(`Unknown argument: ${args[0]}. Use --help for options.`);
    return 1;
  }
  const controller = new AbortController();
  let signals = 0;
  const onSignal = () => {
    signals += 1;
    if (signals === 1) {
      output.stderr(
        `${PREFIX} stopping; send the signal again to force an exit`,
      );
      controller.abort();
      return;
    }
    output.stderr(`${PREFIX} forced exit`);
    (options.exit ?? process.exit)(1);
  };
  try {
    const repoRoot = options.repoRoot ?? process.cwd();
    const config = await loadConfig(repoRoot);
    const mode = (options.stateTrackingMode ?? stateTrackingMode)(config);
    if (!mode.run.allowed) {
      output.stderr(mode.run.reason);
      return 1;
    }
    const runner = options.runner ?? runCommand;
    const now = options.now ?? (() => new Date());
    // One set of dependencies, so that triage and runs share one state.
    const deps = {
      ...createRunOnceDeps({ config, repoRoot, runner, output }),
      now,
    };
    const check = await deps.host.checkCli();
    if (!check.ok) {
      output.stderr(check.message);
      return 1;
    }
    let lock;
    try {
      lock = await (options.acquireLifetimeLock ?? acquireLifetimeLock)({
        repoRoot,
        runner,
        now,
        log: output.stderr,
      });
    } catch (error) {
      if (error instanceof LifetimeLockHeldError) {
        output.stderr(`${PREFIX} ${error.message}`);
        return 2;
      }
      throw error;
    }
    try {
      for (const signal of SIGNALS) process.on(signal, onSignal);
      output.stderr(
        `${PREFIX} started (instance ${lock.record.instanceId}, lock ${lock.path})`,
      );
      const triage = options.runTriage ?? runTriage;
      const result = await (options.runRunnerShell ?? runRunnerShell)({
        workSource: mode.run.createWorkSource({
          config,
          deps,
          runOneIssue: options.runOneIssue ?? runOneIssue,
        }),
        triageGate: localTriageGate({
          intervalMs: config.run.triageIntervalMinutes * 60_000,
          now,
        }),
        async triage(grant, signal) {
          const reporter = createTriageProgressReporter({
            command: "patchmill triage",
            dryRun: false,
            writeLine: output.stdout,
          });
          const outcomes = await triage(config, deps, {
            signal,
            onProgress: reporter.onProgress,
            ...(grant.beforeWrite ? { beforeWrite: grant.beforeWrite } : {}),
          });
          reporter.finish(outcomes.length, signal.aborted);
        },
        backoff: {
          idle: config.run.idleBackoff,
          error: config.run.errorBackoff,
        },
        signal: controller.signal,
        sleep,
        random: Math.random,
        log: output.stderr,
      });
      if (result.kind === "fatal") {
        output.stderr(`${PREFIX} exit 1: ${result.reason}`);
        return 1;
      }
      output.stderr(`${PREFIX} exit 0`);
      return 0;
    } finally {
      await lock.release();
    }
  } catch (error) {
    output.stderr(`${PREFIX} ${errorMessage(error)}`);
    return 1;
  } finally {
    for (const signal of SIGNALS) process.off(signal, onSignal);
  }
}
