import { resolve, join } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import type { Host } from "../host/types.ts";
import { CommandFailedError, type CommandRunner } from "../process/command.ts";
import {
  appendCleanupLog,
  readCleanupReceipt,
  writeCleanupReceipt,
  type CleanupIdentity,
} from "./cleanup-state.ts";
import { cleanupGit, cleanupWorkspaces } from "./cleanup-workspaces.ts";
import { errorMessage } from "./errors.ts";
import type { KernelGit } from "./git.ts";
import type { IssueLock } from "./lock.ts";
import { isIssueBranch, planningBranchName } from "./names.ts";
import { findPullRequest } from "./pull-request.ts";
import { closesIssue } from "./verify.ts";

export type CleanupCandidate = { issue: number; branch: string };
export type CleanupServices = {
  config: PatchmillConfig;
  host: Host;
  git: Pick<KernelGit, "remoteDefaultBranch">;
  runner: CommandRunner;
  repoRoot: string;
  now: () => Date;
  report: (message: string) => void;
  signal?: AbortSignal;
  runLogPath?: string;
};
export type CleanupResult = {
  status: "cleaned" | "kept" | "skipped";
  warnings: string[];
};
type Input = CleanupServices & CleanupCandidate & { lock: IssueLock };

async function mergedIdentity(
  input: Input,
): Promise<CleanupIdentity | undefined> {
  if (
    !Number.isSafeInteger(input.issue) ||
    input.issue <= 0 ||
    !isIssueBranch(input.issue, input.branch) ||
    ["spec", "plan"].some(
      (stage) =>
        input.branch ===
        planningBranchName(input.issue, stage as "spec" | "plan"),
    )
  )
    return undefined;
  const issue = await input.host.viewIssue(input.issue);
  if (issue.number !== input.issue || issue.state !== "closed")
    return undefined;
  const repository = await input.host.repository();
  const baseBranch =
    input.config.git.baseBranch ??
    (await input.git.remoteDefaultBranch()) ??
    repository.defaultBranch;
  const pr = await findPullRequest(input.host, input.branch, baseBranch);
  if (
    !pr ||
    pr.state !== "merged" ||
    pr.baseBranch !== baseBranch ||
    !closesIssue(pr.body, input.issue, repository)
  )
    return undefined;
  return {
    repository: `${repository.owner}/${repository.repo}`.toLowerCase(),
    pushRepository: (await input.host.pushRepository()).toLowerCase(),
    issue: input.issue,
    branch: input.branch,
    baseBranch,
    pullRequest: pr.number,
  };
}

/** Caller retains the issue's permanent OS lock through this whole operation. */
export async function cleanupMergedIssue(input: Input): Promise<CleanupResult> {
  const { config, issue, runner, repoRoot, signal } = input;
  const warnings: string[] = [];
  const result = (status: CleanupResult["status"]): CleanupResult => ({
    status,
    warnings,
  });
  if (signal?.aborted) return result("skipped");
  const issueDir = resolve(repoRoot, config.paths.runsDir, `issue-${issue}`);
  const logPath = join(issueDir, "cleanup.log");
  const reportFailure = (error: unknown) => {
    const message = `Issue #${issue} workspace cleanup failed: ${errorMessage(error)} Log: ${logPath}`;
    warnings.push(message);
    input.report(message);
    return message;
  };
  // A mismatched handle does not authorize even a log write to this issue.
  if (resolve(input.lock.path) !== join(issueDir, "lock")) {
    reportFailure(
      new Error("The supplied lock does not own this issue's lock path."),
    );
    return result("kept");
  }
  const log = (
    message: string,
    output: { stdout?: string; stderr?: string } = {},
  ) =>
    appendCleanupLog({
      issueDir,
      at: input.now().toISOString(),
      message,
      ...output,
      ...(input.runLogPath ? { runLogPath: input.runLogPath } : {}),
    });
  const notify = async (message: string) => {
    input.report(message);
    await log(message);
  };
  const git = cleanupGit(runner, repoRoot);
  try {
    const identity = await mergedIdentity(input);
    if (!identity || signal?.aborted) return result("skipped");
    const workspaceInput = {
      git,
      config,
      repoRoot,
      issue,
      branch: input.branch,
      issueDir,
    };
    let workspaces = await cleanupWorkspaces(workspaceInput);
    if (
      !workspaces.some(
        (workspace) => workspace.registered || workspace.branchExists,
      )
    )
      return result("skipped");
    await log(`Cleanup started: ${JSON.stringify(identity)}`);
    const receipt = await readCleanupReceipt(issueDir);
    if (
      receipt &&
      !Object.entries(identity).every(
        ([key, value]) =>
          receipt.identity[key as keyof CleanupIdentity] === value,
      )
    )
      throw new Error(
        "Cleanup receipt identity does not match the confirmed merge.",
      );
    if (!receipt) {
      if (config.cleanupHook !== undefined) {
        const implementation = workspaces[0]!;
        if (!implementation.registered)
          throw new Error(
            `Implementation worktree is missing: ${implementation.worktree}. Inspect before rerunning the hook.`,
          );
        if (signal?.aborted) return result("skipped");
        await log(
          `Running bash ${config.cleanupHook} from ${implementation.worktree}`,
        );
        const script = resolve(implementation.worktree, config.cleanupHook);
        const output = await runner("bash", [script], {
          cwd: implementation.worktree,
          ...(signal ? { signal } : {}),
        });
        await log(`Cleanup hook exited with code ${output.code}`, output);
        if (output.code !== 0)
          throw new CommandFailedError("bash", [script], output);
        if (signal?.aborted) throw new Error("Cleanup hook interrupted.");
      }
      if (signal?.aborted) return result("skipped");
      await writeCleanupReceipt(issueDir, {
        version: 1,
        identity,
        completedAt: input.now().toISOString(),
        hook:
          config.cleanupHook === undefined
            ? { status: "not-configured" }
            : { status: "succeeded", path: config.cleanupHook },
      });
    }
    workspaces = await cleanupWorkspaces(workspaceInput);
    for (const workspace of workspaces) {
      if (signal?.aborted)
        throw new Error("Cleanup interrupted; remaining targets were kept.");
      try {
        if (workspace.registered) {
          if (
            (
              await git(["status", "--porcelain"], workspace.worktree)
            ).trim() !== ""
          ) {
            const message = `Kept worktree ${workspace.worktree}: it has uncommitted changes.`;
            warnings.push(message);
            await notify(message);
            continue;
          }
          await git(["worktree", "remove", workspace.worktree]);
          await notify(`Removed worktree ${workspace.worktree}.`);
        }
        if (workspace.branchExists) {
          await git(["branch", "-D", workspace.branch]);
          await notify(`Removed local branch ${workspace.branch}.`);
        }
      } catch (error) {
        // Logging failures must stop further removals, unlike independent Git errors.
        if (!(error instanceof CommandFailedError)) throw error;
        await log(reportFailure(error));
      }
    }
    return result(warnings.length ? "kept" : "cleaned");
  } catch (error) {
    const message = reportFailure(error);
    try {
      await log(message);
    } catch (storageError) {
      input.report(
        `Could not record cleanup failure: ${errorMessage(storageError)} Log: ${logPath}`,
      );
    }
    return result("kept");
  }
}
