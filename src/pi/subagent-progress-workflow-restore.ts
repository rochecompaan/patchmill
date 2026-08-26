import {
  subagentProgressKey,
  type ChildLifecycleState,
  type PersistedSubagentProgress,
} from "./subagent-progress.ts";

type WorkflowProgress = Extract<
  PersistedSubagentProgress,
  { kind: "workflow" }
>;

export type RestoredClosedWorkflow = Map<
  string,
  {
    agentSeen: boolean;
    unresolved: boolean;
    lastState?: ChildLifecycleState;
  }
>;

/** Recovers an immutable sealed child inventory from ordered persisted rows. */
export function recoverClosedWorkflow(group: readonly WorkflowProgress[]): {
  closed?: RestoredClosedWorkflow;
  nonDurableSealKeys: Set<string>;
} {
  const byChild = new Map<string, WorkflowProgress[]>();
  for (const progress of group) {
    const rows = byChild.get(progress.childId);
    if (rows) rows.push(progress);
    else byChild.set(progress.childId, [progress]);
  }
  const seals = group.filter((progress) => progress.inventoryClosed === true);
  const lastSealIndex = group.findLastIndex(
    (progress) => progress.inventoryClosed === true,
  );
  // The seal's deterministic child is selected from its pre-seal inventory.
  // A later contradictory ID must not retroactively change that fingerprint.
  const firstChildId =
    lastSealIndex < 0
      ? undefined
      : [
          ...new Set(
            group.slice(0, lastSealIndex + 1).map((row) => row.childId),
          ),
        ].sort()[0];
  const candidateSealIndex =
    lastSealIndex >= 0 &&
    group[lastSealIndex]?.childId === firstChildId &&
    group[lastSealIndex]?.unresolved !== true &&
    !group.slice(lastSealIndex + 1).some((later) => later.unresolved)
      ? lastSealIndex
      : undefined;
  const candidateRows =
    candidateSealIndex === undefined
      ? []
      : group.slice(0, candidateSealIndex + 1);
  const latestFallbackIndex = candidateRows.findLastIndex(
    (progress) => progress.unresolved,
  );
  const repairAttemptRows = candidateRows.slice(latestFallbackIndex + 1);
  const orderedClosure = repairAttemptRows.every(
    (progress) => progress.inventoryClosed || !progress.unresolved,
  );
  const sealedChildren = new Map<string, WorkflowProgress[]>();
  for (const progress of candidateRows) {
    const rows = sealedChildren.get(progress.childId);
    if (rows) rows.push(progress);
    else sealedChildren.set(progress.childId, [progress]);
  }
  const durable =
    candidateSealIndex !== undefined &&
    orderedClosure &&
    [...sealedChildren.values()].every(
      (rows) =>
        rows.some((progress) => progress.agent !== undefined) ||
        rows.some((progress) => progress.unresolved),
    );
  if (!durable) {
    return {
      nonDurableSealKeys: new Set(seals.map(subagentProgressKey)),
    };
  }

  // Rows after a durable seal may enrich only its immutable child fingerprint.
  // A newly introduced ID is contradictory persisted data, not a reopened run.
  for (const progress of group.slice(candidateSealIndex + 1)) {
    const rows = sealedChildren.get(progress.childId);
    if (rows) rows.push(progress);
  }
  return {
    closed: new Map(
      [...sealedChildren].map(([id, rows]) => {
        const last = rows.at(-1)!;
        return [
          id,
          {
            agentSeen: rows.some((progress) => progress.agent !== undefined),
            unresolved: rows.some((progress) => progress.unresolved),
            ...(last.state ? { lastState: last.state } : {}),
          },
        ];
      }),
    ),
    nonDurableSealKeys: new Set(),
  };
}
