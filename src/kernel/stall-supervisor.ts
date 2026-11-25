import fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  CAP_CHECKPOINT_MS,
  startPiRpc,
  type PiRpcOptions,
  type PiRpcSession,
} from "./pi-rpc.ts";
import type { Phase } from "./phase.ts";
import type { PiSession } from "./pi-supervisor.ts";
import {
  createStallWatch,
  type Stall,
  type StallDecision,
  type StallLimits,
} from "./stall-watch.ts";

export type StallNotice = {
  stall: Stall;
  action: "recorded" | "recovering" | "restarted" | "blocked";
};
export type StallClock = {
  /** Monotonic milliseconds. */
  now(): number;
  /** Calls `fn` every `ms` and returns a function that cancels it. */
  every(ms: number, fn: () => void): () => void;
};

const REAL_CLOCK: StallClock = {
  now: () => performance.now(),
  every: (ms, fn) => {
    const timer = setInterval(fn, ms);
    timer.unref?.();
    return () => clearInterval(timer);
  },
};

/** At most 15 s apart in production; a quarter of a short test limit. */
export function defaultPollMs(stopAfterMs: number): number {
  return stopAfterMs > 0
    ? Math.min(15_000, Math.max(stopAfterMs / 4, 10))
    : 15_000;
}

/**
 * Run one unattended phase Pi RPC session under the Stall rules. A Stall stop
 * aborts the turn and continues the same session with a recovery prompt. When
 * Pi does not answer the abort, Pi is stopped and restarted on the same
 * session file with the remaining time of the Session cap, if one applies. A
 * restart inside the Cap checkpoint lead sends the checkpoint at once. The
 * Stall limit stops Pi and returns the reason in `block`.
 */
export async function superviseStalls(options: {
  rpc: Omit<PiRpcOptions, "onRecord">;
  limits: StallLimits;
  phase: Phase;
  pollMs?: number;
  recoveryGraceMs?: number;
  clock?: StallClock;
  start?: (options: PiRpcOptions) => PiRpcSession;
  onStall: (notice: StallNotice) => Promise<void>;
}): Promise<{
  session: PiSession;
  stalls: Stall[];
  block?: { reason: string };
}> {
  const clock = options.clock ?? REAL_CLOCK;
  const start = options.start ?? startPiRpc;
  const graceMs = options.recoveryGraceMs ?? 30_000;
  const { rpc, limits, onStall } = options;
  const watch = createStallWatch({
    sessionDir: rpc.sessionDir,
    limits,
    phase: options.phase,
    now: () => clock.now(),
  });
  const deadline =
    rpc.timeoutMs !== undefined ? clock.now() + rpc.timeoutMs : undefined;
  const lead = rpc.checkpointBeforeMs ?? CAP_CHECKPOINT_MS;
  const onRecord = (record: { type?: unknown }) => watch.record(record);
  let session = start({ ...rpc, onRecord });
  let block: { reason: string } | undefined;
  let restarting: Promise<void> | undefined;
  let ticking: Promise<void> | undefined;
  let failure: unknown;
  let restarts = 0;

  const stopWith = async (
    decision: Extract<StallDecision, { kind: "block" }>,
  ) => {
    block = { reason: decision.reason };
    // Stop first: an interrupted session sends no Result reminder.
    const stopping = session.stop();
    const last = decision.stalls.at(-1);
    if (last) await onStall({ stall: last, action: "blocked" });
    await stopping;
  };

  const restart = async (prompt: string) => {
    await session.stop();
    await session.done.catch(() => undefined);
    const file = watch.sessionFile();
    const remaining =
      deadline !== undefined ? deadline - clock.now() : undefined;
    if (!file || (remaining !== undefined && remaining <= 0))
      return stopWith(watch.fail(file ? "no time left" : "no session file"));
    restarts++;
    const promptPath = join(
      dirname(resolve(rpc.cwd, rpc.promptPath)),
      `recovery-${restarts}.md`,
    );
    await fs.writeFile(promptPath, prompt);
    const { timeoutMs: _cap, checkpointNow: _now, ...rest } = rpc;
    session = start({
      ...rest,
      onRecord,
      promptPath,
      sessionFile: file,
      appendLogs: true,
      ...(remaining !== undefined ? { timeoutMs: remaining } : {}),
      ...(remaining !== undefined && rpc.timeoutMs! > lead && remaining <= lead
        ? { checkpointNow: true }
        : {}),
    });
  };

  const handle = async (decision: StallDecision) => {
    if (decision.kind === "recorded")
      return onStall({ stall: decision.stall, action: "recorded" });
    if (decision.kind === "block") return stopWith(decision);
    await onStall({ stall: decision.stall, action: "recovering" });
    const outcome = await session.recover(decision.prompt, graceMs);
    watch.recovered();
    if (outcome === "continued") return;
    restarting = restart(decision.restartPrompt);
    await restarting;
    if (!block) await onStall({ stall: decision.stall, action: "restarted" });
  };

  const tick = () => {
    if (ticking || block) return;
    ticking = (async () => {
      try {
        for (const decision of await watch.poll()) {
          await handle(decision);
          if (block) return;
        }
      } catch (error) {
        failure ??= error;
        await session.stop();
      }
    })().finally(() => {
      ticking = undefined;
    });
  };

  const cancel = clock.every(
    options.pollMs ?? defaultPollMs(limits.stopAfterMs),
    tick,
  );
  let result: PiSession;
  try {
    for (;;) {
      const current = session;
      result = await current.done;
      if (restarting) await restarting.catch(() => undefined);
      restarting = undefined;
      if (session === current) break;
    }
    if (ticking) await ticking;
  } finally {
    cancel();
  }
  if (failure) throw failure;
  return {
    session: result,
    stalls: [...watch.stalls()],
    ...(block ? { block } : {}),
  };
}
