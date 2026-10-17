import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadConfig, type PatchmillConfig } from "../../../config/config.ts";
import type { CliOutput } from "../../main.ts";
import { resolveBundledPiCommand, type PiCommandSpec } from "../../pi-cli.ts";

export function authSpawnPlan(
  repoRoot: string,
  config: PatchmillConfig,
  pi: PiCommandSpec,
): {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
} {
  return {
    command: pi.command,
    args: [...pi.argsPrefix],
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: resolve(repoRoot, config.pi.agentDir),
    },
  };
}

export async function main(
  args: string[] = process.argv.slice(2),
  options: {
    repoRoot?: string;
    piCommand?: PiCommandSpec;
    spawn?: typeof spawn;
    output?: CliOutput;
  } = {},
): Promise<number> {
  const output = options.output ?? {
    stdout: console.log,
    stderr: console.error,
  };
  if (args.length === 1 && ["--help", "-h", "help"].includes(args[0]!)) {
    output.stdout(
      "Usage: patchmill auth\nOpen interactive Pi for repo-local provider authentication.",
    );
    return 0;
  }
  try {
    if (args.length)
      throw new Error(`Unknown argument: ${args[0]}. Use --help.`);
    const repoRoot = options.repoRoot ?? process.cwd();
    const config = await loadConfig(repoRoot);
    const plan = authSpawnPlan(
      repoRoot,
      config,
      options.piCommand ?? resolveBundledPiCommand(),
    );
    return await new Promise<number>((resolve, reject) => {
      const child = (options.spawn ?? spawn)(plan.command, plan.args, {
        cwd: repoRoot,
        env: plan.env,
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
