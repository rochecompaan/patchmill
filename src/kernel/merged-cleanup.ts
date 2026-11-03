import { dirname, join } from "node:path";
import { CommandFailedError, type CommandRunner } from "../process/command.ts";
import type { Facts } from "./facts.ts";
import type { HumanChannel } from "./human-channel.ts";
import { planningBranchName, worktreeDirName } from "./names.ts";

/** Best-effort cleanup only after an interactive continue confirms the merge. */
export async function cleanupMergedIssue(input: {
  facts: Pick<Facts, "worktree" | "branch">;
  issue: number;
  runner: CommandRunner;
  repoRoot: string;
  human: HumanChannel;
}): Promise<void> {
  const { facts, issue, runner, repoRoot, human } = input;
  const git = async (args: string[], cwd = repoRoot) => {
    const result = await runner("git", args, { cwd });
    if (result.code !== 0) throw new CommandFailedError("git", args, result);
    return result.stdout.trim();
  };
  const report = (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    human.notify(`Issue workspace cleanup failed: ${reason}`);
  };
  let worktrees: Set<string>;
  let branches: Set<string>;
  try {
    worktrees = new Set(
      (await git(["worktree", "list", "--porcelain"]))
        .split("\n")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice(9)),
    );
    branches = new Set(
      (
        await git(["for-each-ref", "--format=%(refname:short)", "refs/heads"])
      ).split("\n"),
    );
  } catch (error) {
    report(error);
    return;
  }
  const workspaces = [
    facts,
    ...(["spec", "plan"] as const).map((stage) => {
      const branch = planningBranchName(issue, stage);
      return {
        branch,
        worktree: join(dirname(facts.worktree), worktreeDirName(branch)),
      };
    }),
  ];
  for (const { worktree, branch } of workspaces) {
    try {
      if (worktrees.has(worktree)) {
        if ((await git(["status", "--porcelain"], worktree)) !== "") {
          human.notify(
            `Kept worktree ${worktree}: it has uncommitted changes.`,
          );
          continue;
        }
        await git(["worktree", "remove", worktree]);
      }
      if (branches.has(branch)) await git(["branch", "-D", branch]);
    } catch (error) {
      report(error);
    }
  }
}
