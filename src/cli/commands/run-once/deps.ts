import type { PatchmillConfig } from "../../../config/config.ts";
import { createHost } from "../../../host/factory.ts";
import { createKernelGit } from "../../../kernel/git.ts";
import type { RunOnceDeps } from "../../../kernel/run-once.ts";
import { createWorkflowState } from "../../../kernel/workflow-factory.ts";
import { resolvePiSubagentsPackageRoot } from "../../../pi/pi-subagents-package.ts";
import type { CommandRunner } from "../../../process/command.ts";
import type { CliOutput } from "../../main.ts";
import { resolveBundledPiCommand } from "../../pi-cli.ts";

/** The run-once dependencies for one repository. The terminal console and
 * Web session processes build the same object. */
export function createRunOnceDeps(input: {
  config: PatchmillConfig;
  repoRoot: string;
  runner: CommandRunner;
  output: CliOutput;
}): RunOnceDeps {
  const { config, repoRoot, runner, output } = input;
  const host = createHost(config, runner, repoRoot);
  const now = () => new Date();
  const workflow = createWorkflowState({
    config,
    host,
    repoRoot,
    now,
    warn: (message) => output.stderr(`Warning: ${message}`),
  });
  return {
    host,
    workflow,
    runner,
    git: createKernelGit(runner, repoRoot),
    piCommand: resolveBundledPiCommand(),
    extensionPaths: [resolvePiSubagentsPackageRoot()],
    repoRoot,
    now,
    output,
  };
}
