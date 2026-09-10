import {
  PlanningIssueLockConflictError,
  acquirePlanningIssueLock,
  releasePlanningIssueLock,
  type PlanningIssueLock,
} from "../../../workflow/planning-issue-lock.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state.ts";
import type {
  AgentIssueBlockedResult,
  AgentIssueStoppedResult,
  IssueSummary,
} from "./types.ts";

export type PlanningPipelineResult =
  | AgentIssueStoppedResult
  | { status: "blocked"; issue: IssueSummary; result: AgentIssueBlockedResult }
  | { status: "coordinated"; issue: IssueSummary; state: PlanningStateV1 };

export async function runPlanningIssue(input: {
  issue: IssueSummary;
  state: PlanningStateV1;
  runStateDir: string;
  stateStore: Pick<PlanningStateStore, "read" | "initialize">;
  readIssue: () => Promise<IssueSummary>;
  readLegacy: () => Promise<boolean>;
  mutate: () => Promise<void>;
  coordinate: (
    state: PlanningStateV1,
    lock: PlanningIssueLock,
  ) => Promise<PlanningStateV1>;
  acquire?: typeof acquirePlanningIssueLock;
  release?: typeof releasePlanningIssueLock;
}): Promise<PlanningPipelineResult> {
  const acquire = input.acquire ?? acquirePlanningIssueLock;
  const release = input.release ?? releasePlanningIssueLock;
  let lock: PlanningIssueLock | undefined;
  try {
    try {
      lock = await acquire(input.runStateDir, {
        issueNumber: input.issue.number,
        runId: input.state.runId,
      });
    } catch (error) {
      if (error instanceof PlanningIssueLockConflictError) {
        if (error.diagnostic.classification === "active")
          return {
            status: "stopped",
            issue: input.issue,
            reason: "issue-locked",
          };
        return {
          status: "blocked",
          issue: input.issue,
          result: {
            status: "blocked",
            reason: `issue-lock-${error.diagnostic.classification}`,
            questions: [],
            commits: [],
            validation: [],
          },
        };
      }
      throw error;
    }
    const [issue, state, legacy] = await Promise.all([
      input.readIssue(),
      input.stateStore.read(input.issue.number),
      input.readLegacy(),
    ]);
    if (
      issue.number !== input.issue.number ||
      issue.title !== input.issue.title ||
      issue.state !== "open" ||
      legacy
    )
      return {
        status: "blocked",
        issue: input.issue,
        result: {
          status: "blocked",
          reason: "planning-identity-changed",
          questions: [],
          commits: [],
          validation: [],
        },
      };
    const current = state ?? input.state;
    if (!state) await input.stateStore.initialize({ state: current, lock });
    await input.mutate();
    return {
      status: "coordinated",
      issue,
      state: await input.coordinate(current, lock),
    };
  } finally {
    if (lock) await release(lock);
  }
}
