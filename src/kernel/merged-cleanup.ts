import { CommandFailedError, type CommandRunner } from "../process/command.ts";
import type { Facts } from "./facts.ts";
import type { HumanChannel } from "./human-channel.ts";

/** Best-effort cleanup only after an interactive continue confirms the merge. */
export async function cleanupMergedIssue(input: {
  facts: Pick<Facts, "worktree" | "branch">;
  runner: CommandRunner;
  repoRoot: string;
  human: HumanChannel;
}): Promise<void> {
  const { facts, runner, repoRoot, human } = input;
  const git = async (args: string[], cwd = repoRoot) => {
    const result = await runner("git", args, { cwd });
    if (result.code !== 0) throw new CommandFailedError("git", args, result);
    return result.stdout.trim();
  };
  try {
    if ((await git(["status", "--porcelain"], facts.worktree)) !== "") {
      human.notify(
        `Kept worktree ${facts.worktree}: it has uncommitted changes.`,
      );
      return;
    }
    await git(["worktree", "remove", facts.worktree]);
    await git(["branch", "-D", facts.branch]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    human.notify(`Issue workspace cleanup failed: ${reason}`);
  }
}
