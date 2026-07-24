import type { CommandRunner } from "../cli/commands/triage/types.ts";
import { withTeaContext } from "./forgejo-tea-context.ts";
import {
  pullRequestNumber,
  sameCanonicalUrl,
} from "./pull-request-reference.ts";
export type ForgejoPrBodyOptions = {
  runner: CommandRunner;
  repoRoot: string;
  login?: string;
};
function output(result: { stdout: string; stderr: string }): string {
  return (
    [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") ||
    "no output"
  );
}
export async function readForgejoPullRequestBody(
  options: ForgejoPrBodyOptions,
  prUrl: string,
): Promise<string> {
  const number = pullRequestNumber(prUrl, "pulls");
  const args = withTeaContext(
    ["api", `/repos/{owner}/{repo}/pulls/${number}`],
    options.repoRoot,
    options.login,
  );
  const result = await options.runner.run("tea", args, {
    cwd: options.repoRoot,
  });
  if (result.code !== 0) throw new Error(`tea api failed: ${output(result)}`);
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch (cause) {
    throw new Error("tea api returned invalid JSON", { cause });
  }
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Record<string, unknown>).body !== "string" ||
    typeof (value as Record<string, unknown>).html_url !== "string" ||
    !sameCanonicalUrl(prUrl, (value as Record<string, string>).html_url)
  )
    throw new Error("tea api returned an invalid or mismatched PR body");
  return (value as Record<string, string>).body;
}
export async function updateForgejoPullRequestBody(
  options: ForgejoPrBodyOptions,
  prUrl: string,
  body: string,
): Promise<void> {
  const number = pullRequestNumber(prUrl, "pulls");
  const result = await options.runner.run(
    "tea",
    withTeaContext(
      ["pulls", "edit", String(number), "--description", body],
      options.repoRoot,
      options.login,
    ),
    { cwd: options.repoRoot },
  );
  if (result.code !== 0)
    throw new Error(`tea pulls edit failed: ${output(result)}`);
}
