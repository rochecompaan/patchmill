import type { CommandResult } from "../../src/cli/commands/run-once/types.ts";

export type PlanningForgejoPull = Readonly<{
  number: number;
  branch: string;
  body: string;
  headOid: string;
  merged?: boolean;
  closed?: boolean;
  mergeOid?: string;
}>;

export function forgejoPullPayload(pull: PlanningForgejoPull) {
  const repository = {
    name: "patchmill",
    full_name: "acme/patchmill",
    owner: { login: "acme" },
    html_url: "https://forge.test/acme/patchmill",
  };
  return {
    number: pull.number,
    html_url: `https://forge.test/acme/patchmill/pulls/${pull.number}`,
    body: pull.body,
    state: pull.merged || pull.closed ? "closed" : "open",
    merged: pull.merged === true,
    merge_commit_sha: pull.mergeOid ?? null,
    base: { ref: "main", repo: repository },
    head: { ref: pull.branch, sha: pull.headOid, repo: repository },
  };
}

export function forgejoResult(stdout: unknown): CommandResult {
  return { code: 0, stdout: JSON.stringify(stdout), stderr: "" };
}
