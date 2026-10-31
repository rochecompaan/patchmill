import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  loadConfig,
} from "../../../config/config.ts";
import { createHost } from "../../../host/factory.ts";
import type { Host, HostProviderId } from "../../../host/types.ts";
import { findPackageRoot } from "../../../package-root.ts";
import { runCommand, type CommandRunner } from "../../../process/command.ts";
import type { CliOutput } from "../../main.ts";
import {
  ensureLocalExcludes,
  provisionAgentDir,
  REVIEWER_AGENT,
} from "./agent-dir.ts";
import { installSkills } from "./skill-installer.ts";

const HELP =
  "Usage: patchmill init [--provider github-gh|forgejo-tea] [--login NAME]";
type Options = {
  repoRoot?: string;
  runner?: CommandRunner;
  host?: Pick<Host, "checkCli">;
  output?: CliOutput;
};

function parseArgs(args: string[]) {
  let provider: HostProviderId = "github-gh";
  let login: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (!["--provider", "--login"].includes(flag) || seen.has(flag))
      throw new Error(`Unknown or repeated argument: ${flag}. ${HELP}`);
    seen.add(flag);
    const value = args[++i];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}. ${HELP}`);
    if (flag === "--login") login = value;
    else if (value === "github-gh" || value === "forgejo-tea") provider = value;
    else throw new Error(`Invalid provider: ${value}. ${HELP}`);
  }
  return { provider, login };
}

async function optionalText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function main(
  args: string[] = process.argv.slice(2),
  options: Options = {},
): Promise<number> {
  const output = options.output ?? {
    stdout: console.log,
    stderr: console.error,
  };
  if (args.length === 1 && ["--help", "-h", "help"].includes(args[0]!)) {
    output.stdout(HELP);
    return 0;
  }
  try {
    const flags = parseArgs(args);
    const repoRoot = options.repoRoot ?? process.cwd();
    const configPath = join(repoRoot, CONFIG_FILE);
    const exists = (await optionalText(configPath)) !== undefined;
    const config = exists
      ? await loadConfig(repoRoot)
      : structuredClone(DEFAULT_CONFIG);
    if (!exists) {
      config.host.provider = flags.provider;
      config.host.login = flags.login ?? "";
    }
    const host =
      options.host ??
      createHost(config, options.runner ?? runCommand, repoRoot);
    try {
      const check = await host.checkCli();
      if (!check.ok) output.stderr(`Warning: ${check.message}`);
      else if (
        !exists &&
        flags.login === undefined &&
        config.host.provider === "github-gh"
      ) {
        config.host.login = check.login ?? "";
      }
      output.stdout(`Host: ${check.ok ? "ready" : "unchanged (not ready)"}`);
    } catch (error) {
      output.stderr(
        `Warning: ${error instanceof Error ? error.message : String(error)}`,
      );
      output.stdout("Host: unchanged (not ready)");
    }
    if (!exists)
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    output.stdout(`Configuration: ${exists ? "unchanged" : "written"}`);
    const counts = await installSkills({
      repoRoot,
      skillDir: ".patchmill/skills",
      packageRoot: findPackageRoot(dirname(fileURLToPath(import.meta.url))),
    });
    output.stdout(
      `Skills: ${counts.written} written, ${counts.unchanged} unchanged`,
    );
    const reviewer = join(repoRoot, config.pi.agentDir, "agents/reviewer.md");
    const unchanged = (await optionalText(reviewer)) === REVIEWER_AGENT;
    await provisionAgentDir(repoRoot, config.pi.agentDir);
    output.stdout(`Agent directory: ${unchanged ? "unchanged" : "written"}`);
    const added = await ensureLocalExcludes(
      repoRoot,
      [config.paths.worktreeDir, config.pi.agentDir, config.paths.runsDir].map(
        (path) => `${path.replace(/\/+$/, "")}/`,
      ),
    );
    output.stdout(
      `Local excludes: ${added.length ? `${added.length} added` : "unchanged"}`,
    );
    return 0;
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
