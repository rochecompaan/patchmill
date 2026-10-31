import { loadConfig } from "../../../config/config.ts";
import { createHost } from "../../../host/factory.ts";
import { ensureLabels } from "../../../kernel/labels.ts";
import { runCommand, type CommandRunner } from "../../../process/command.ts";
import type { CliOutput } from "../../main.ts";

const HELP = `Usage: patchmill labels setup
Create missing repository labels. Existing labels stay unchanged.`;

type Options = {
  runner?: CommandRunner;
  output?: CliOutput;
  repoRoot?: string;
};

export async function main(
  args: string[] = process.argv.slice(2),
  options: Options = {},
): Promise<number> {
  const output = options.output ?? {
    stdout: console.log,
    stderr: console.error,
  };
  if (args.length === 0) {
    output.stdout(HELP);
    return 1;
  }
  if (["--help", "-h", "help"].includes(args[0]!) && args.length === 1) {
    output.stdout(HELP);
    return 0;
  }
  if (args[0] !== "setup" || args.length !== 1) {
    output.stderr("Use patchmill labels setup to create missing labels.");
    output.stderr(HELP);
    return 1;
  }
  try {
    const repoRoot = options.repoRoot ?? process.cwd();
    const config = await loadConfig(repoRoot);
    const host = createHost(config, options.runner ?? runCommand, repoRoot);
    const check = await host.checkCli();
    if (!check.ok) throw new Error(check.message);
    const created = await ensureLabels(host, config.labels);
    if (created.length === 0) output.stdout("all labels present");
    else for (const name of created) output.stdout(`Created label: ${name}`);
    return 0;
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
