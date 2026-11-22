import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PiCommandSpec } from "../cli/pi-cli.ts";
import type { Phase } from "./phase.ts";
import { runPiRpc } from "./pi-rpc.ts";
import type { PiSession } from "./pi-supervisor.ts";
import { parseAgentResult, type ParsedResult } from "./result.ts";

export type PhaseLaunch = {
  phase: Phase;
  planningGate?: { required: boolean; pullRequest: boolean };
  planningReview?: {
    issue: { number: number; title: string };
    stage: "spec" | "plan" | "implementation";
    branch: string;
    specsDir: string;
    plansDir: string;
    parentSpec?: { issue: number; path: string };
    earlierStage?: "spec" | "plan";
  };
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
  planningApproval?: "pr" | "no-pr";
  result: ParsedResult;
  session: Pick<PiSession, "exitCode" | "timedOut" | "aborted"> &
    Partial<Pick<PiSession, "signal">>;
};
export type PhaseLauncher = (launch: PhaseLaunch) => Promise<PhaseRun>;

/**
 * The Pi extension that reports outstanding background subagent work, so that
 * an RPC session finishes where print mode would. It has the extension of this
 * module: `.ts` from source, `.js` from `dist`.
 */
export const BACKGROUND_WORK_EXTENSION_PATH = fileURLToPath(
  new URL(
    `../pi/background-work-extension${extname(fileURLToPath(import.meta.url))}`,
    import.meta.url,
  ),
);

export function rpcModeLauncher(options: {
  command: PiCommandSpec;
  agentDir: string;
  extensionPaths: string[];
}): PhaseLauncher {
  return async (launch) => {
    const session = await runPiRpc({
      command: options.command,
      cwd: launch.worktree,
      agentDir: options.agentDir,
      sessionDir: launch.sessionDir,
      skillPath: launch.skillPath,
      promptPath: launch.promptPath,
      logPath: launch.logPath,
      aggregateLogPath: launch.aggregateLogPath,
      // First, so its shutdown handler runs before pi-subagents removes its bridge.
      extensionPaths: [
        BACKGROUND_WORK_EXTENSION_PATH,
        ...options.extensionPaths,
      ],
      timeoutMs: launch.timeoutMs,
      // Keep the agent protocol in the logs, not the operator's terminal.
      onOutput: () => {},
      ...(launch.signal ? { signal: launch.signal } : {}),
    });
    const result = parseAgentResult(session.stdout);
    return { result, session };
  };
}
