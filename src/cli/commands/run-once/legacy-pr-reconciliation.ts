import type { PullRequestHost } from "../../../host/pull-requests.ts";
import { parseCanonicalPullRequestUrl } from "../../../host/pull-request-reference.ts";
import type { PlanningPublicationOperations } from "../../../git/planning-publication-git.ts";
import {
  reconcileImplementationPullRequest,
  type ImplementationPrEvidence,
  type ImplementationPrReconciliation,
} from "../../../workflow/implementation-pr-reconciliation.ts";
import type { AgentIssueRunState } from "./types.ts";
import { validateRecoveryRunState } from "./run-state.ts";

export type LegacyPrReconciliation =
  | (Exclude<ImplementationPrReconciliation, { kind: "blocked" }> & {
      evidence: ImplementationPrEvidence;
    })
  | Extract<ImplementationPrReconciliation, { kind: "blocked" }>;

/** Adopts old receipts only with saved head proof; never infers merge from missing refs. */
export async function reconcileLegacyImplementationPr(input: {
  state: AgentIssueRunState;
  issueNumber: number;
  baseBranch: string;
  remote: string;
  host: PullRequestHost;
  fetchBase: () => Promise<{ baseOid: string }>;
  git: Pick<PlanningPublicationOperations, "assertAncestor">;
}): Promise<LegacyPrReconciliation> {
  validateRecoveryRunState(input.state, input.issueNumber);
  const { state } = input;
  if (!state.prUrl || !state.branch)
    return {
      kind: "blocked",
      reason:
        "Saved direct landing or incomplete PR evidence needs deliberate migration; preserve this checkpoint.",
    };
  let evidence = state.implementationPr;
  if (!evidence) {
    const targetRepository = await input.host.resolveTargetRepositoryIdentity();
    const parsed = parseCanonicalPullRequestUrl(state.prUrl, targetRepository);
    const headOid = state.commits?.at(-1);
    if (
      !parsed ||
      parsed.url !== state.prUrl ||
      !headOid ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(headOid)
    )
      return {
        kind: "blocked",
        reason:
          "Older PR receipt has no exact canonical URL and saved head proof; preserve it for migration.",
      };
    const headRepository = await input.host.resolveRemoteRepositoryIdentity(
      input.remote,
    );
    evidence = {
      ...parsed,
      publication: {
        targetRepository,
        headRepository,
        baseBranch: input.baseBranch,
        headBranch: state.branch,
        headOid,
      },
      ownershipMarkerRequired: false,
    };
  }
  if (
    evidence.url !== state.prUrl ||
    evidence.publication.headBranch !== state.branch ||
    evidence.publication.baseBranch !== input.baseBranch
  )
    return {
      kind: "blocked",
      reason: "Saved PR identity conflicts with this issue or configuration",
    };
  const result = await reconcileImplementationPullRequest({
    ...input,
    evidence,
  });
  if (result.kind === "blocked") return result;
  if (
    state.merge &&
    (result.kind !== "merged" || state.merge.mergeOid !== result.mergeOid)
  )
    return {
      kind: "blocked",
      reason: "Saved merge proof conflicts with the host PR",
    };
  return { ...result, evidence };
}
