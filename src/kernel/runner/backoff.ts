export type BackoffDelay = { initialSeconds: number; maxSeconds: number };
export type RunBackoffConfig = { idle: BackoffDelay; error: BackoffDelay };

/**
 * The wait in milliseconds before the next pass. `streak` counts the passes
 * in a row of one kind, from 1. The base doubles per streak step up to the
 * cap, and the jitter keeps the delay between half and all of the base.
 */
export function backoffDelay(
  delay: BackoffDelay,
  streak: number,
  random: number,
): number {
  const base = Math.min(
    delay.maxSeconds,
    delay.initialSeconds * 2 ** Math.max(0, streak - 1),
  );
  return Math.floor(base * (0.5 + 0.5 * random) * 1000);
}
