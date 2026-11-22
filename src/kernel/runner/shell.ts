import { errorMessage } from "../errors.ts";
import { backoffDelay, type RunBackoffConfig } from "./backoff.ts";

export type PassResult =
  | { kind: "worked" } // run the next pass now
  | { kind: "idle"; reason: string } // back off
  | { kind: "fatal"; reason: string }; // stop for operator action

export type WorkSource = {
  /** One pass of unattended work. A throw is an error pass. */
  pass(signal: AbortSignal): Promise<PassResult>;
};

export type TriageGrant = {
  /** Passed to runTriage as `beforeWrite`. #361 checks its lease here. */
  beforeWrite?: () => Promise<void>;
  release(): Promise<void>;
};

export type TriageGate = {
  /** Undefined when triage must not run now. */
  tryGrant(): Promise<TriageGrant | undefined>;
};

export type RunnerShellInput = {
  workSource: WorkSource;
  triageGate: TriageGate;
  triage(grant: TriageGrant, signal: AbortSignal): Promise<void>;
  backoff: RunBackoffConfig;
  signal: AbortSignal;
  /** Resolves after `ms`, or early when `signal` aborts. Never rejects. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** A number in [0, 1). */
  random(): number;
  log(line: string): void;
};

export type RunnerShellResult =
  | { kind: "stopped" }
  | { kind: "fatal"; reason: string };

const PREFIX = "patchmill run:";

/**
 * Loops until the signal aborts or a pass is fatal. Each cycle runs triage
 * when the gate grants it, then one work pass, then waits after an idle or
 * failed pass. A stop lets the active triage or pass finish first.
 */
export async function runRunnerShell(
  input: RunnerShellInput,
): Promise<RunnerShellResult> {
  const { signal, log } = input;
  let idleStreak = 0;
  let errorStreak = 0;
  const wait = async (ms: number) => {
    log(`${PREFIX} waiting ${Math.round(ms / 1000)} s`);
    await input.sleep(ms, signal);
  };
  while (!signal.aborted) {
    await triageWhenGranted(input);
    if (signal.aborted) break;
    let result: PassResult;
    try {
      result = await input.workSource.pass(signal);
    } catch (error) {
      if (signal.aborted) {
        // Not an error pass, but the operator must learn why it ended.
        log(`${PREFIX} pass ended after the stop: ${errorMessage(error)}`);
        break;
      }
      idleStreak = 0;
      errorStreak += 1;
      log(`${PREFIX} pass failed: ${errorMessage(error)}`);
      await wait(
        backoffDelay(input.backoff.error, errorStreak, input.random()),
      );
      continue;
    }
    if (result.kind === "fatal") {
      log(`${PREFIX} stopping for operator action: ${result.reason}`);
      return { kind: "fatal", reason: result.reason };
    }
    if (signal.aborted) break;
    if (result.kind === "worked") {
      idleStreak = 0;
      errorStreak = 0;
      log(`${PREFIX} pass worked`);
      continue;
    }
    errorStreak = 0;
    idleStreak += 1;
    log(`${PREFIX} idle: ${result.reason}`);
    await wait(backoffDelay(input.backoff.idle, idleStreak, input.random()));
  }
  log(`${PREFIX} stopped`);
  return { kind: "stopped" };
}

async function triageWhenGranted(input: RunnerShellInput): Promise<void> {
  let grant: TriageGrant | undefined;
  try {
    grant = await input.triageGate.tryGrant();
  } catch (error) {
    input.log(`${PREFIX} triage failed: ${errorMessage(error)}`);
    return;
  }
  if (!grant) return;
  input.log(`${PREFIX} triage started`);
  try {
    await input.triage(grant, input.signal);
    input.log(`${PREFIX} triage finished`);
  } catch (error) {
    input.log(`${PREFIX} triage failed: ${errorMessage(error)}`);
  } finally {
    try {
      await grant.release();
    } catch (error) {
      input.log(`${PREFIX} triage release failed: ${errorMessage(error)}`);
    }
  }
}
