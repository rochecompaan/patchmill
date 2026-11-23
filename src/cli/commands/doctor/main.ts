import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../../config/config.ts";
import { createHost } from "../../../host/factory.ts";
import type { Host } from "../../../host/types.ts";
import { findPackageRoot } from "../../../package-root.ts";
import { runCommand, type CommandRunner } from "../../../process/command.ts";
import type { CliOutput } from "../../main.ts";
import { resolveBundledPiCommand, type PiCommandSpec } from "../../pi-cli.ts";
import { provisionReviewerAgent } from "../init/agent-dir.ts";
import { runDoctorChecks } from "./checks.ts";

export async function main(
  args: string[] = process.argv.slice(2),
  options: {
    repoRoot?: string;
    runner?: CommandRunner;
    host?: Host;
    piCommand?: PiCommandSpec;
    output?: CliOutput;
  } = {},
): Promise<number> {
  const output = options.output ?? {
    stdout: console.log,
    stderr: console.error,
  };
  if (args.length === 1 && ["--help", "-h", "help"].includes(args[0]!)) {
    output.stdout(
      "Usage: patchmill doctor [--fix]\nCheck readiness. --fix restores the managed reviewer agent definition.",
    );
    return 0;
  }
  try {
    const unknown = args.find((arg, index) => arg !== "--fix" || index > 0);
    if (unknown !== undefined)
      throw new Error(`Unknown argument: ${unknown}. Use --help.`);
    const fix = args.length === 1;
    const repoRoot = options.repoRoot ?? process.cwd();
    const config = await loadConfig(repoRoot);
    if (
      fix &&
      (await provisionReviewerAgent(repoRoot, config.pi.agentDir)) === "written"
    )
      output.stdout(
        `[fixed] reviewer: wrote ${join(resolve(repoRoot, config.pi.agentDir), "agents", "reviewer.md")}`,
      );
    const runner = options.runner ?? runCommand;
    const checks = await runDoctorChecks({
      repoRoot,
      config,
      runner,
      host: options.host ?? createHost(config, runner, repoRoot),
      piCommand: options.piCommand ?? resolveBundledPiCommand(),
      packageRoot: findPackageRoot(dirname(fileURLToPath(import.meta.url))),
    });
    for (const check of checks)
      output.stdout(`[${check.status}] ${check.name}: ${check.message}`);
    return checks.some((check) => check.status === "fail") ? 1 : 0;
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
