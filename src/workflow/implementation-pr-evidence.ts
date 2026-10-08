import { parseCanonicalPullRequestUrl } from "../host/pull-request-reference.ts";
import {
  sameRepositoryIdentity,
  type RepositoryIdentity,
} from "../host/pull-requests.ts";
import {
  isPlanningBranch,
  planningOid,
} from "../git/planning-git-validation.ts";
import type { ImplementationPrEvidence } from "./implementation-pr-reconciliation.ts";

function invalid(): never {
  throw new Error("Invalid implementation PR evidence");
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  )
    return invalid();
  return record;
}
function repository(value: unknown): RepositoryIdentity {
  const parsed = object(value, ["provider", "host", "owner", "repository"]);
  if (
    (parsed.provider !== "github-gh" && parsed.provider !== "forgejo-tea") ||
    [parsed.host, parsed.owner, parsed.repository].some(
      (value) => typeof value !== "string" || value.trim() === "",
    )
  )
    return invalid();
  return parsed as RepositoryIdentity;
}

/** Strict saved receipts distinguish old absence from corrupt ownership data. */
export function assertImplementationPrEvidence(
  value: unknown,
): asserts value is ImplementationPrEvidence {
  const evidence = object(value, [
    "reference",
    "url",
    "publication",
    "ownershipMarkerRequired",
  ]);
  const reference = object(evidence.reference, ["targetRepository", "number"]);
  const publication = object(evidence.publication, [
    "targetRepository",
    "headRepository",
    "baseBranch",
    "headBranch",
    "headOid",
  ]);
  const target = repository(publication.targetRepository);
  repository(publication.headRepository);
  if (
    typeof evidence.ownershipMarkerRequired !== "boolean" ||
    typeof evidence.url !== "string" ||
    !Number.isSafeInteger(reference.number) ||
    Number(reference.number) <= 0 ||
    typeof publication.baseBranch !== "string" ||
    !isPlanningBranch(publication.baseBranch) ||
    typeof publication.headBranch !== "string" ||
    !isPlanningBranch(publication.headBranch) ||
    typeof publication.headOid !== "string" ||
    !planningOid.test(publication.headOid)
  )
    return invalid();
  const canonical = parseCanonicalPullRequestUrl(evidence.url, target);
  if (
    !canonical ||
    canonical.url !== evidence.url ||
    canonical.reference.number !== reference.number ||
    !sameRepositoryIdentity(repository(reference.targetRepository), target)
  )
    return invalid();
}

export function assertImplementationMergeEvidence(
  value: unknown,
): asserts value is { mergeOid: string; mergedBaseOid: string } {
  const merge = object(value, ["mergeOid", "mergedBaseOid"]);
  if (
    [merge.mergeOid, merge.mergedBaseOid].some(
      (value) => typeof value !== "string" || !planningOid.test(value),
    )
  )
    return invalid();
}
