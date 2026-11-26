import { dirname, join } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import type { Host } from "../host/types.ts";
import { errorMessage } from "../kernel/errors.ts";
import { acquireLock, LockHeldError } from "../kernel/lock.ts";
import {
  claimRetro,
  type RetroEnd,
  type RetroScope,
} from "../kernel/retro-record.ts";
import { retroInstructions } from "../kernel/retro-session.ts";

/** What the console needs to run an interactive Retro. */
export type ConsoleRetro = {
  config: PatchmillConfig;
  repoRoot: string;
  host: Host;
  now?: () => Date;
};

export type RetroClaim =
  | { ok: true; scope: RetroScope; issueDir: string }
  | { ok: false; text: string };

/**
 * Claims the Retro of an Issue run end under the issue lock. An interactive
 * Retro always uses `file-issues`: the maintainer approves each filing.
 */
export async function claimConsoleRetro(
  retro: ConsoleRetro,
  input: { runDir: string; end: RetroEnd },
): Promise<RetroClaim> {
  const issueDir = dirname(input.runDir);
  const now = retro.now ?? (() => new Date());
  let lock;
  try {
    lock = await acquireLock(join(issueDir, "lock"), { now });
  } catch (error) {
    return {
      ok: false,
      text:
        error instanceof LockHeldError
          ? "Another Patchmill process holds the issue lock. No Retro was started."
          : `Could not take the issue lock: ${errorMessage(error)}`,
    };
  }
  try {
    const scope = await claimRetro({
      issueDir,
      end: input.end,
      mode: "file-issues",
      now,
    });
    return scope
      ? { ok: true, scope, issueDir }
      : { ok: false, text: "A Retro for this Issue run end already exists." };
  } finally {
    await lock.release();
  }
}

/** The Retro instructions for the Console agent. */
export function consoleRetroInstructions(
  retro: ConsoleRetro,
  claim: { scope: RetroScope; issueDir: string },
  issue: number,
): Promise<string> {
  return retroInstructions({
    config: retro.config,
    host: retro.host,
    repoRoot: retro.repoRoot,
    issue,
    issueDir: claim.issueDir,
    scope: claim.scope,
    interactive: true,
  });
}
