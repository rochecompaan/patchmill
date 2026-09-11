import type { CommandResult } from "../../src/cli/commands/run-once/types.ts";

export type PlanningGithubPull = Readonly<{
  number: number;
  branch: string;
  body: string;
  headOid: string;
  merged?: boolean;
  mergeOid?: string;
}>;

export function githubPullPayload(pull: PlanningGithubPull) {
  return {
    number: pull.number,
    url: `https://github.test/acme/patchmill/pull/${pull.number}`,
    body: pull.body,
    state: pull.merged ? "MERGED" : "OPEN",
    mergeCommit: pull.mergeOid ? { oid: pull.mergeOid } : null,
    baseRefName: "main",
    headRefName: pull.branch,
    headRefOid: pull.headOid,
    headRepository: { nameWithOwner: "acme/patchmill" },
  };
}

export function githubResult(stdout: unknown): CommandResult {
  return { code: 0, stdout: JSON.stringify(stdout), stderr: "" };
}
