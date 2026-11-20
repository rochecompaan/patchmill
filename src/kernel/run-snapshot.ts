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
export type ObservedRunOutcome = {
  status: "completed" | "stopped" | "paused";
  label: "done" | "inProgress" | "needsInfo";
};
export type RunSnapshot = {
  issue: number;
  title?: string;
  runId: string;
  runDir: string;
  startedAt: string;
  state: RunState;
  phase?: Phase;
  session: number;
  facts?: Facts;
  usage?: PiUsage;
  summary?: string;
  outcome?: ObservedRunOutcome;
};

/** Write-only progress projection; never drives the run's decisions. */
export function runSnapshot(
  identity: Pick<RunSnapshot, "issue" | "runId" | "runDir" | "startedAt">,
  observe: ((snapshot: RunSnapshot) => void) | undefined,
  report: (line: string) => void,
  persist?: (snapshot: RunSnapshot) => Promise<void>,
) {
  let current: RunSnapshot = { ...identity, state: "deriving", session: 0 };
  const warning = (kind: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    report(`Run snapshot ${kind} failed: ${message.replace(/[\r\n]+/g, " ")}`);
  };
  const save = async () => {
    try {
      await persist?.(current);
    } catch (error) {
      warning("persistence", error);
    }
  };
  const emit = async (update: Partial<RunSnapshot>) => {
    current = { ...current, ...update };
    await save();
    try {
      observe?.(current);
    } catch (error) {
      warning("observer", error);
    }
  };
  return {
    title(title: string) {
      current = { ...current, title };
    },
    async deriving() {
      current = { ...current };
      delete current.phase;
      await emit({ state: "deriving" });
    },
    async facts(facts: Facts) {
      current = { ...current, facts };
      await save();
    },
    phase: (phase: Phase, session: number) =>
      emit({ state: phase, phase, session }),
    wait: (state: "gate-wait" | "review-wait" | "blocked") => emit({ state }),
    async session() {
      const usage = await sumSessionUsage(join(identity.runDir, "sessions"));
      current = { ...current };
      delete current.usage;
      await emit(usage ? { usage } : {});
    },
    ended: (summary: string, outcome: ObservedRunOutcome) =>
      emit({ state: "ended", summary, outcome }),
  };
}
