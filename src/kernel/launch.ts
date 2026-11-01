import type { PiCommandSpec } from "../cli/pi-cli.ts";
import type { Phase } from "./phase.ts";
import { supervisePi, type PiSession } from "./pi-supervisor.ts";
import { parseAgentResult, type ParsedResult } from "./result.ts";

export type PhaseLaunch = {
  phase: Phase;
  envelope: string;
  promptPath: string;
  worktree: string;
  skillPath: string;
  sessionDir: string;
  logPath: string;
  aggregateLogPath: string;
  timeoutMs: number;
  signal?: AbortSignal;
};
export type PhaseRun = {
  result: ParsedResult;
  session: Pick<PiSession, "exitCode" | "timedOut" | "aborted">;
};
export type PhaseLauncher = (launch: PhaseLaunch) => Promise<PhaseRun>;

export function printModeLauncher(options: {
  command: PiCommandSpec;
  agentDir: string;
  extensionPaths: string[];
}): PhaseLauncher {
  return async (launch) => {
    const session = await supervisePi({
      command: options.command,
      cwd: launch.worktree,
      agentDir: options.agentDir,
      sessionDir: launch.sessionDir,
      skillPath: launch.skillPath,
      promptPath: launch.promptPath,
      logPath: launch.logPath,
      aggregateLogPath: launch.aggregateLogPath,
      extensionPaths: options.extensionPaths,
      timeoutMs: launch.timeoutMs,
      // Keep the agent protocol in the logs, not the operator's terminal.
      onOutput: () => {},
      ...(launch.signal ? { signal: launch.signal } : {}),
    });
    const result = parseAgentResult(session.stdout);
    return { result, session };
  };
}
