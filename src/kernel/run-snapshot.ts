import { join } from "node:path";
import type { Facts } from "./facts.ts";
import type { Phase } from "./phase.ts";
import { sumSessionUsage, type PiUsage } from "./pi-cost.ts";

export type RunState =
  | "deriving"
  | "planning"
  | "implementation"
  | "gate-wait"
  | "review-wait"
  | "blocked"
  | "ended";
export type RunSnapshot = {
  issue: number;
  runId: string;
  runDir: string;
  startedAt: string;
  state: RunState;
  phase?: Phase;
  session: number;
  facts?: Facts;
  usage?: PiUsage;
  summary?: string;
};

/** Write-only progress projection; never drives the run's decisions. */
export function runSnapshot(
  identity: Pick<RunSnapshot, "issue" | "runId" | "runDir" | "startedAt">,
  observe: ((snapshot: RunSnapshot) => void) | undefined,
  report: (line: string) => void,
) {
  let current: RunSnapshot = { ...identity, state: "deriving", session: 0 };
  const emit = (update: Partial<RunSnapshot>) => {
    current = { ...current, ...update };
    try {
      observe?.(current);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report(
        `Run snapshot observer failed: ${message.replace(/[\r\n]+/g, " ")}`,
      );
    }
  };
  return {
    deriving() {
      current = { ...current };
      delete current.phase;
      emit({ state: "deriving" });
    },
    facts: (facts: Facts) => {
      current = { ...current, facts };
    },
    phase: (phase: Phase, session: number) =>
      emit({ state: phase, phase, session }),
    wait: (state: "gate-wait" | "review-wait") => emit({ state }),
    async session() {
      const usage = await sumSessionUsage(join(identity.runDir, "sessions"));
      current = { ...current };
      delete current.usage;
      emit(usage ? { usage } : {});
    },
    ended: (summary: string) => emit({ state: "ended", summary }),
  };
}
