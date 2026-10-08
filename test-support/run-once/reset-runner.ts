import type { AgentIssueConfig } from "../../src/cli/commands/run-once/types.ts";
import type { CommandRunner } from "../../src/command/types.ts";
import { createCommandRunner } from "../command-runner.ts";
/** Real, receipt-capable Git with controlled host identity and command failures. */
export function createResetFixtureRunner(
  config: AgentIssueConfig,
  fail?: (args: string[]) => boolean,
): CommandRunner {
  const runner = createCommandRunner();
  return {
    supportsOwnedGit: true,
    async run(command, args, options = {}) {
      if (
        command === "tea" &&
        args[0] === "api" &&
        args[1] === "/repos/{owner}/{repo}"
      )
        return {
          code: 0,
          stdout: JSON.stringify({
            name: "test-repo",
            full_name: "test-owner/test-repo",
            owner: { login: "test-owner" },
            html_url: "https://forgejo.test/test-owner/test-repo",
          }),
          stderr: "",
        };
      if (command !== "git")
        throw new Error(`Unexpected reset command: ${command}`);
      if (fail?.(args)) {
        await runner.run(
          "git",
          ["rev-parse", "--verify", "refs/fixture/missing"],
          { ...options, cwd: options.cwd ?? config.repoRoot },
        );
        return { code: 1, stdout: "", stderr: "injected failure" };
      }
      return runner.run(command, args, {
        ...options,
        cwd: options.cwd ?? config.repoRoot,
      });
    },
  };
}
