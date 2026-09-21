import { definition } from "./result-diagnostic-helpers.ts";
import type {
  ImplementationDiagnosticReasonCode,
  RunOnceDiagnosticCatalog,
} from "./result-diagnostic-types.ts";
const same = (guidance: string) => ({ kind: "same-result" as const, guidance });
const after = (guidance: string) => ({
  kind: "after-action" as const,
  guidance,
});
const inspect = (guidance: string) => ({
  kind: "inspect-first" as const,
  guidance,
});
export const IMPLEMENTATION_DIAGNOSTICS = {
  "implementation-configuration": definition({
    summary: "Implementation configuration differs",
    explanation:
      "Current Git remote or base configuration differs from the pinned implementation phase.",
    action:
      "Restore the reported pinned remote/base or reconcile the phase through reviewed operator action.",
    safety: "Do not repoint the phase to unrelated history.",
    retry: same("An immediate retry will give the same result."),
  }),
  "implementation-workspace": definition({
    summary: "Implementation workspace is unsafe",
    explanation:
      "The implementation workspace is dirty, missing, or no longer proven to descend from saved evidence.",
    action:
      "Inspect the path, branch, state, status, and head OIDs; preserve all work before retrying.",
    safety:
      "Do not clean, reset, delete, or recreate the workspace speculatively.",
    retry: inspect("Inspect the preserved workspace before retrying."),
  }),
  "implementation-direct-merge": definition({
    summary: "Implementation was directly merged",
    explanation:
      "The implementation agent reported a direct merge where this workflow requires an open pull request.",
    action:
      "Inspect the reported branch and merge commit, then reconcile landed state manually.",
    safety: "Do not create duplicate work or reverse a merge automatically.",
    retry: inspect("Inspect landed state before retrying."),
  }),
  "implementation-ancestry": definition({
    summary: "Implementation ancestry is invalid",
    explanation:
      "Reported implementation commits are not on the pinned base-to-head ancestry path.",
    action:
      "Inspect base, saved head, observed head, and commits; repair existing branch history through normal review.",
    safety: "Do not force-push, reset, or discard commits.",
    retry: same("An immediate retry will give the same result."),
  }),
  "implementation-remote-head": definition({
    summary: "Remote implementation head differs",
    explanation:
      "The remote implementation branch is absent or differs from the verified local head.",
    action:
      "Inspect remote, branch, and expected/observed OIDs and repair the existing publication safely.",
    safety: "Do not force-update the branch without confirming ownership.",
    retry: after("Retry after the existing branch publication is repaired."),
  }),
  "implementation-url": definition({
    summary: "Implementation pull request URL is invalid",
    explanation:
      "The reported pull-request URL is not canonical for the expected target repository.",
    action:
      "Inspect the reported URL and locate or repair the existing pull request in the expected repository.",
    safety:
      "Do not create a replacement while an existing artifact may own the branch.",
    retry: after("Retry after existing pull-request evidence is repaired."),
  }),
  "implementation-branch": definition({
    summary: "Implementation branch differs",
    explanation:
      "The agent-reported branch differs from the owned phase-workspace branch.",
    action:
      "Inspect both branch names and correct existing pull-request/reporting evidence.",
    safety: "Do not rename or delete the owned branch speculatively.",
    retry: same("An immediate retry will give the same result."),
  }),
  "implementation-evidence": definition({
    summary: "Implementation evidence is invalid",
    explanation:
      "Durable implementation evidence failed planning-state validation.",
    action:
      "Inspect the reported validation fact and existing state and pull-request evidence, then repair source evidence.",
    safety: "Do not hand-edit durable state to bypass validation.",
    retry: inspect("Inspect source evidence before retrying."),
  }),
  "implementation-validation": definition({
    summary: "Implementation validation failed",
    explanation:
      "The existing implementation pull request or workspace failed a named validation check.",
    action:
      "Inspect validation evidence, repair the existing artifact, then rerun.",
    safety:
      "Do not replace the pull request, branch, or workspace merely to clear validation.",
    retry: after("Retry after the existing artifact passes validation."),
  }),
} satisfies Pick<RunOnceDiagnosticCatalog, ImplementationDiagnosticReasonCode>;
