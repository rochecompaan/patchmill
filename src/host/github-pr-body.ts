import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "../cli/commands/triage/types.ts";
import {
  pullRequestNumber,
  sameCanonicalUrl,
} from "./pull-request-reference.ts";
export type GitHubPrBodyOptions = { runner: CommandRunner; repoRoot: string };
function output(result: { stdout: string; stderr: string }): string {
  return (
    [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") ||
    "no output"
  );
}
function bodyPayload(stdout: string, url: string): string {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch (cause) {
    throw new Error("gh pr view returned invalid JSON", { cause });
  }
  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as Record<string, unknown>).body !== "string" ||
    typeof (data as Record<string, unknown>).url !== "string" ||
    !sameCanonicalUrl(url, (data as Record<string, string>).url)
  )
    throw new Error("gh pr view returned an invalid or mismatched PR body");
  return (data as Record<string, string>).body;
}
export async function readGitHubPullRequestBody(
  options: GitHubPrBodyOptions,
  prUrl: string,
): Promise<string> {
  const number = pullRequestNumber(prUrl, "pull");
  const result = await options.runner.run(
    "gh",
    ["pr", "view", String(number), "--json", "body,url"],
    { cwd: options.repoRoot, env: { GH_REPO: undefined } },
  );
  if (result.code !== 0)
    throw new Error(`gh pr view failed: ${output(result)}`);
  return bodyPayload(result.stdout, prUrl);
}
export async function updateGitHubPullRequestBody(
  options: GitHubPrBodyOptions,
  prUrl: string,
  body: string,
): Promise<void> {
  const number = pullRequestNumber(prUrl, "pull");
  const directory = await mkdtemp(join(tmpdir(), "patchmill-pr-body-"));
  try {
    const path = join(directory, "body.md");
    await writeFile(path, body, "utf8");
    const result = await options.runner.run(
      "gh",
      ["pr", "edit", String(number), "--body-file", path],
      { cwd: options.repoRoot, env: { GH_REPO: undefined } },
    );
    if (result.code !== 0)
      throw new Error(`gh pr edit failed: ${output(result)}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
