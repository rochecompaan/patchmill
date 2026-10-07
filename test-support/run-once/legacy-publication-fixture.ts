import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommandResult } from "../../src/command/types.ts";
import type { Call } from "./mock-runner.ts";
export type LegacyFixturePublication = {
  prUrl: string;
  branch: string;
  issueNumber: number;
  baseBranch: string;
};
export const LEGACY_FIXTURE_HEAD = "b".repeat(40);
const repository = {
  name: "test-repo",
  full_name: "test-owner/test-repo",
  owner: { login: "test-owner" },
  html_url: "https://forgejo.test/test-owner/test-repo",
};
export function canonicalLegacyFixtureUrl(url: string) {
  return url.replace(
    /^https:\/\/forgejo(?:\.example)?\/pr\/(\d+)$/u,
    "https://forgejo.test/test-owner/test-repo/pulls/$1",
  );
}
/** Older pipeline tests use placeholder URLs; host-proof tests use real provider fixtures. */
export function normalizeLegacyFixturePublication(
  result: CommandResult,
): CommandResult {
  return {
    ...result,
    stdout: result.stdout.replace(
      /https:\/\/forgejo(?:\.example)?\/pr\/\d+/gu,
      canonicalLegacyFixtureUrl,
    ),
  };
}
export async function legacyPublicationFixtureFallback(
  call: Call,
  publication?: LegacyFixturePublication,
): Promise<CommandResult | undefined> {
  const ok = (stdout: string): CommandResult => ({
    code: 0,
    stdout,
    stderr: "",
  });
  const url =
    publication && URL.canParse(publication.prUrl)
      ? new URL(publication.prUrl)
      : undefined;
  const parts = url?.pathname.split("/");
  const repo =
    parts?.[3] === "pulls"
      ? {
          name: parts[2],
          full_name: `${parts[1]}/${parts[2]}`,
          owner: { login: parts[1] },
          html_url: `${url!.origin}/${parts[1]}/${parts[2]}`,
        }
      : repository;
  if (
    call.command === "git" &&
    call.args[0] === "remote" &&
    call.args[1] === "get-url"
  )
    return ok(`${repo.html_url}.git\n`);
  if (
    call.command === "git" &&
    call.args[0] === "rev-parse" &&
    call.args[1] === "--verify" &&
    call.args[2]?.startsWith("refs/heads/") &&
    publication?.branch &&
    call.args[2] === `refs/heads/${publication.branch}^{commit}`
  )
    return ok(`${LEGACY_FIXTURE_HEAD}\n`);
  if (call.command !== "tea" || call.args[0] !== "api") return undefined;
  if (
    call.args[1] === "/repos/{owner}/{repo}" &&
    !call.args.includes("--method")
  )
    return ok(JSON.stringify(repo));
  if (
    call.args[1]?.startsWith("/repos/{owner}/{repo}/pulls?") &&
    !call.args.includes("--method")
  )
    return ok("[]");
  const match = /^\/repos\/\{owner\}\/\{repo\}\/pulls\/(\d+)$/u.exec(
    call.args[1] ?? "",
  );
  if (!match || call.args.includes("--method")) return undefined;
  const number = Number(match[1]);
  let branch = publication?.branch;
  if (!branch && call.cwd) {
    try {
      const state = JSON.parse(
        await readFile(
          join(call.cwd, ".patchmill", "runs", `issue-${number}.json`),
          "utf8",
        ),
      );
      branch = state.branch;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!branch) return undefined;
  const issueNumber =
    publication?.issueNumber ?? Number(/issue-(\d+)/u.exec(branch)?.[1]);
  return ok(
    JSON.stringify({
      number,
      html_url: `${repo.html_url}/pulls/${number}`,
      body: `Closes #${issueNumber}\n<!-- patchmill:planning-pr-v1 issue=${issueNumber} phase=implementation -->`,
      state: "open",
      merged: false,
      merge_commit_sha: null,
      base: { ref: publication?.baseBranch ?? "main", repo },
      head: { ref: branch, sha: LEGACY_FIXTURE_HEAD, repo },
    }),
  );
}
