import type { TriageGate } from "./shell.ts";

/**
 * Grants triage at the first call, then once each `intervalMs`. The interval
 * counts from the previous grant, not from the end of its triage.
 */
export function localTriageGate(input: {
  intervalMs: number;
  now: () => Date;
}): TriageGate {
  let lastGrant: number | undefined;
  return {
    async tryGrant() {
      const time = input.now().getTime();
      if (lastGrant !== undefined && time - lastGrant < input.intervalMs)
        return undefined;
      lastGrant = time;
      return { release: async () => {} };
    },
  };
}
