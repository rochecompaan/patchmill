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
  const deterministicSeals = new Map<number, boolean>();
  let firstChildId: string | undefined;
  for (const [index, progress] of group.entries()) {
    if (firstChildId === undefined || progress.childId < firstChildId)
      firstChildId = progress.childId;
    if (progress.inventoryClosed)
      deterministicSeals.set(index, progress.childId === firstChildId);
  }
  const hasUnresolvedAfter = new Map<number, boolean>();
  const hasMalformedSealAfter = new Map<number, boolean>();
  let unresolvedAfter = false;
  let malformedSealAfter = false;
  for (let index = group.length - 1; index >= 0; index -= 1) {
    const progress = group[index]!;
    hasUnresolvedAfter.set(index, unresolvedAfter);
    if (progress.inventoryClosed) {
      hasMalformedSealAfter.set(index, malformedSealAfter);
      if (!deterministicSeals.get(index)) malformedSealAfter = true;
    }
    if (progress.unresolved) unresolvedAfter = true;
  }

  let candidateSealIndex: number | undefined;
  let sealedChildren: Map<string, WorkflowProgress[]> | undefined;
  const children = new Map<string, WorkflowProgress[]>();
  const childrenWithEvidence = new Set<string>();
  // The first durable seal locks the fingerprint. Later seals can repair an
  // earlier non-durable attempt, but cannot replace a durable inventory.
  for (const [index, progress] of group.entries()) {
    const rows = children.get(progress.childId);
    if (rows) rows.push(progress);
    else children.set(progress.childId, [progress]);
    if (progress.agent !== undefined || progress.unresolved)
      childrenWithEvidence.add(progress.childId);
    if (
      !progress.inventoryClosed ||
      !deterministicSeals.get(index) ||
      hasMalformedSealAfter.get(index) ||
      progress.unresolved ||
      hasUnresolvedAfter.get(index) ||
      childrenWithEvidence.size !== children.size
    )
      continue;
    candidateSealIndex = index;
    sealedChildren = new Map(
      [...children].map(([id, childRows]) => [id, [...childRows]]),
    );
    break;
  }
  if (candidateSealIndex === undefined || !sealedChildren) {
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
