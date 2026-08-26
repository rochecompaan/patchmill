import { createSubagentProgressCorrelator } from "./subagent-progress-correlation.ts";
import type { PersistedSubagentProgress } from "./subagent-progress.ts";

export function harness() {
  const entries: PersistedSubagentProgress[] = [];
  let nextError: Error | undefined;
  let successfulAppendsBeforeError = 0;
  const correlator = createSubagentProgressCorrelator({
    append(progress) {
      if (nextError && successfulAppendsBeforeError === 0) {
        const error = nextError;
        nextError = undefined;
        throw error;
      }
      if (nextError) successfulAppendsBeforeError -= 1;
      entries.push(progress);
    },
  });
  return {
    entries,
    correlator,
    fail(error: Error) {
      nextError = error;
      successfulAppendsBeforeError = 0;
    },
    failAfter(error: Error, successfulAppends: number) {
      nextError = error;
      successfulAppendsBeforeError = successfulAppends;
    },
  };
}
