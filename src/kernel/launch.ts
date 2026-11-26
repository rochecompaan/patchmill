import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PiCommandSpec } from "../cli/pi-cli.ts";
import type { Phase } from "./phase.ts";
import { COMMAND_TIMEOUT_EXTENSION_PATH } from "../pi/command-timeout-extension.ts";
import { runPiRpc, type PiRpcOptions } from "./pi-rpc.ts";
import { superviseStalls, type StallNotice } from "./stall-supervisor.ts";
import type { Stall, StallLimits } from "./stall-watch.ts";
import type { PiSession } from "./pi-supervisor.ts";
import {
  hasResultBlock,
  parseAgentResult,
  RESULT_REMINDER,
  type ParsedResult,
} from "./result.ts";

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
  /** The Session cap in milliseconds. Without it, no deadline applies. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Receives each Stall of a launch with a Stall policy. */
  onStall?: (notice: StallNotice) => Promise<void>;
};
export type PhaseRun = {
  planningApproval?: "pr" | "no-pr";
  result: ParsedResult;
  session: Pick<PiSession, "exitCode" | "timedOut" | "aborted"> &
    Partial<Pick<PiSession, "signal">>;
  /** The Stalls of a launch with a Stall policy. */
  stalls?: Stall[];
  /** The blocked reason when the launch reached the Stall limit. */
  stallBlock?: string;
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
  /** Added to Pi's environment, for example the Command timeout limits. */
  env: Record<string, string>;
  /** The Stall policy of an unattended phase session. */
  stall?: { limits: StallLimits; phase: Phase };
}): PhaseLauncher {
  return async (launch) => {
    let reminded = false;
    const rpc: PiRpcOptions = {
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
        COMMAND_TIMEOUT_EXTENSION_PATH,
        ...options.extensionPaths,
      ],
      env: options.env,
      ...(launch.timeoutMs !== undefined
        ? { timeoutMs: launch.timeoutMs }
        : {}),
      // Keep the agent protocol in the logs, not the operator's terminal.
      onOutput: () => {},
      remind: (stdout) => {
        if (hasResultBlock(stdout)) return undefined;
        reminded = true;
        return RESULT_REMINDER;
      },
      ...(launch.signal ? { signal: launch.signal } : {}),
    };
    if (!options.stall) {
      const session = await runPiRpc(rpc);
      return {
        result: parseAgentResult(session.stdout, { reminded }),
        session,
      };
    }
    const supervised = await superviseStalls({
      rpc,
      limits: options.stall.limits,
      phase: options.stall.phase,
      onStall: launch.onStall ?? (async () => {}),
    });
    const { session } = supervised;
    return {
      result: parseAgentResult(session.stdout, { reminded }),
      session,
      ...(supervised.stalls.length ? { stalls: supervised.stalls } : {}),
      ...(supervised.block ? { stallBlock: supervised.block.reason } : {}),
    };
  };
}
