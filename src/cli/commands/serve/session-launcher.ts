import { resolve } from "node:path";
import type { PatchmillConfig } from "../../../config/config.ts";
import {
  acquireConsoleLock,
  CONSOLE_SESSION_BUSY,
} from "../../../console/console-lock.ts";
import { openIssueConsoleSession } from "../../../console/console-session.ts";
import { consoleSkillPaths } from "../../../console/skills.ts";
import { WEB_SESSION_EXTENSION_PATH } from "../../../console/web-session-extension.ts";
import { prepareInteractiveRun } from "../../../kernel/interactive-start.ts";
import { startInteractivePi } from "../../../kernel/pi-rpc-interactive.ts";
import {
  COMMAND_TIMEOUT_EXTENSION_PATH,
  commandLimits,
  commandLimitsEnv,
} from "../../../pi/command-timeout-extension.ts";
import { resolvePiSubagentsPackageRoot } from "../../../pi/pi-subagents-package.ts";
import type { CommandRunner } from "../../../process/command.ts";
import type { SessionLauncher } from "../../../web/session/types.ts";
import { provisionAgentDir } from "../init/agent-dir.ts";
import { resolveBundledPiCommand } from "../../pi-cli.ts";
import { createRunOnceDeps } from "../run-once/deps.ts";

/** Production launcher: the console start checks, then one RPC Pi process. */
export function createSessionLauncher(input: {
  config: PatchmillConfig;
  repoRoot: string;
  runner: CommandRunner;
  prepare?: typeof prepareInteractiveRun;
  start?: typeof startInteractivePi;
}): SessionLauncher {
  const { config, repoRoot, runner } = input;
  const prepare = input.prepare ?? prepareInteractiveRun;
  const start = input.start ?? startInteractivePi;
  const runsDir = config.paths.runsDir;
  return async (issue, handlers, report, signal) => {
    const cancelled = {
      kind: "refused",
      reason: "The start was cancelled.",
    } as const;
    const deps = createRunOnceDeps({
      config,
      repoRoot,
      runner,
      output: { stdout: report, stderr: report },
    });
    const prepared = await prepare({ config, deps, issue, report, signal });
    if (prepared.kind === "refused")
      return { kind: "refused", reason: prepared.reason };
    if (prepared.kind === "none")
      return {
        kind: "refused",
        reason: `Issue #${issue} is not open or cannot run.`,
      };
    if (prepared.kind === "cancelled" || signal.aborted) return cancelled;
    const skillPaths = consoleSkillPaths(config, repoRoot);
    await provisionAgentDir(
      repoRoot,
      config.pi.agentDir,
      config.pi.timeoutMinutes,
      skillPaths,
    );
    const lock = await acquireConsoleLock(repoRoot, runsDir, issue);
    if (!lock) return { kind: "refused", reason: CONSOLE_SESSION_BUSY(issue) };
    let sessionFile: string | undefined;
    try {
      sessionFile = (
        await openIssueConsoleSession(repoRoot, runsDir, issue)
      ).getSessionFile();
    } finally {
      // The Pi process takes the lock again in its extension.
      await lock.release();
    }
    if (!sessionFile) throw new Error("The Console session has no file.");
    if (signal.aborted) return cancelled;
    const consoleDir = resolve(repoRoot, runsDir, `issue-${issue}`, "console");
    const pi = start({
      command: resolveBundledPiCommand(),
      cwd: repoRoot,
      agentDir: resolve(repoRoot, config.pi.agentDir),
      sessionFile,
      sessionDir: consoleDir,
      skillPaths,
      extensionPaths: [
        resolvePiSubagentsPackageRoot(),
        WEB_SESSION_EXTENSION_PATH,
        COMMAND_TIMEOUT_EXTENSION_PATH,
      ],
      env: {
        ...commandLimitsEnv(commandLimits(config.pi)),
        PATCHMILL_WEB_SESSION_REPO: repoRoot,
        PATCHMILL_WEB_SESSION_ISSUE: String(issue),
      },
      logPath: resolve(consoleDir, "web-session.log"),
      ...handlers,
    });
    return { kind: "started", pi };
  };
}
