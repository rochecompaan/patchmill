export const TRIAGE_CANONICAL_BUCKETS = [
  "agent-ready",
  "needs-info",
  "agent-unsuitable",
] as const;

export type PatchmillTriageCanonicalBucket =
  (typeof TRIAGE_CANONICAL_BUCKETS)[number];

export type PatchmillTriageStateMap = Record<
  string,
  PatchmillTriageCanonicalBucket
>;

type TriageStateMapLabels = {
  ready: string;
  needsInfo: string;
  unsuitable: string;
};

function isCanonicalBucket(
  value: string,
): value is PatchmillTriageCanonicalBucket {
  return TRIAGE_CANONICAL_BUCKETS.includes(
    value as PatchmillTriageCanonicalBucket,
  );
}

export function defaultTriageStateMap(
  labels: TriageStateMapLabels,
): PatchmillTriageStateMap {
  return {
    [labels.ready]: "agent-ready",
    [labels.needsInfo]: "needs-info",
    [labels.unsuitable]: "agent-unsuitable",
  };
}

export function cloneTriageStateMap(
  stateMap: PatchmillTriageStateMap,
): PatchmillTriageStateMap {
  return { ...stateMap };
}

export function validateTriageStateMap(
  stateMap: Record<string, string>,
  readyLabel: string,
): PatchmillTriageStateMap {
  const parsed: PatchmillTriageStateMap = {};
  for (const [label, bucket] of Object.entries(stateMap)) {
    if (!isCanonicalBucket(bucket)) {
      throw new Error(
        `Invalid patchmill.config.json: triage.stateMap.${label} must be one of ${TRIAGE_CANONICAL_BUCKETS.join(", ")}; received ${JSON.stringify(bucket)}`,
      );
    }
    parsed[label] = bucket;
  }

  if (parsed[readyLabel] !== "agent-ready") {
    throw new Error(
      `Invalid patchmill.config.json: triage.stateMap must map ready label ${readyLabel} to agent-ready`,
    );
  }

  return parsed;
}

export function nonReadyStateLabels(
  stateMap: PatchmillTriageStateMap,
): string[] {
  return Object.entries(stateMap)
    .filter(([, bucket]) => bucket !== "agent-ready")
    .map(([label]) => label)
    .sort((left, right) => left.localeCompare(right));
}

export function canonicalBucketForLabels(
  labels: readonly string[],
  stateMap: PatchmillTriageStateMap,
): PatchmillTriageCanonicalBucket | undefined {
  const buckets = labels
    .map((label) => stateMap[label])
    .filter((bucket): bucket is PatchmillTriageCanonicalBucket =>
      Boolean(bucket),
    );

  for (const bucket of TRIAGE_CANONICAL_BUCKETS) {
    if (buckets.includes(bucket)) return bucket;
  }

  return undefined;
}
