import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PatchmillConfig } from "../../../config/config.ts";
import type { Host } from "../../../host/types.ts";
import { supervisePi } from "../../../kernel/pi-supervisor.ts";
import { resolvePiSubagentsPackageRoot } from "../../../pi/pi-subagents-package.ts";
import { commandOutput, type CommandRunner } from "../../../process/command.ts";
import type { PiCommandSpec } from "../../pi-cli.ts";

export type DoctorCheck = {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
};

async function missingFiles(paths: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const path of paths) {
    try {
      if (!(await stat(path)).isFile()) missing.push(path);
    } catch (error) {
      if (
        ["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        missing.push(path);
      else throw error;
    }
  }
  return missing;
}

export async function runDoctorChecks(deps: {
  repoRoot: string;
  config: PatchmillConfig;
  host: Host;
  runner: CommandRunner;
  piCommand: PiCommandSpec;
  packageRoot: string;
}): Promise<DoctorCheck[]> {
  const { repoRoot, config, host, runner } = deps;
  const checks: DoctorCheck[] = [];
  async function check(
    name: string,
    severity: "warn" | "fail",
    probe: () => Promise<string | undefined>,
  ) {
    try {
      const message = await probe();
      checks.push({
        name,
        status: message ? severity : "pass",
        message: message ?? "Ready",
      });
    } catch (error) {
      checks.push({
        name,
        status: severity,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await check("host CLI", "fail", async () => {
    const result = await host.checkCli();
    return result.ok ? undefined : result.message || "Host CLI check failed";
  });
  await check("labels", "fail", async () => {
    const labels = await host.listLabels();
    const missing = Object.values(config.labels).filter(
      (name) => !labels.includes(name),
    );
    return missing.length ? `Missing labels: ${missing.join(", ")}` : undefined;
  });
  await check("excludes", "warn", async () => {
    const warnings: string[] = [];
    for (const path of [
      config.paths.worktreeDir,
      config.paths.runsDir,
      config.pi.agentDir,
    ]) {
      try {
        const result = await runner("git", ["check-ignore", "-q", path], {
          cwd: repoRoot,
        });
        if (result.code !== 0)
          warnings.push(
            `${path}: ${result.code === 1 ? "not ignored" : commandOutput(result)}`,
          );
      } catch (error) {
        warnings.push(`${path}: ${String(error)}`);
      }
    }
    return warnings.length ? warnings.join("; ") : undefined;
  });
  await check("skills", "fail", async () => {
    const missing = await missingFiles(
      Object.values(config.skills).map((path) =>
        resolve(repoRoot, path, "SKILL.md"),
      ),
    );
    return missing.length
      ? `Missing skill files: ${missing.join(", ")}`
      : undefined;
  });
  await check("reviewer", "warn", async () => {
    const missing = await missingFiles([
      resolve(repoRoot, config.pi.agentDir, "agents/reviewer.md"),
    ]);
    return missing.length ? `Missing reviewer: ${missing[0]}` : undefined;
  });
  await check("pi-subagents", "fail", async () => {
    resolvePiSubagentsPackageRoot();
    return undefined;
  });
  await check("Pi smoke", "fail", async () => {
    const runs = resolve(repoRoot, config.paths.runsDir);
    await mkdir(runs, { recursive: true });
    const runDir = await mkdtemp(join(runs, "doctor-"));
    const logPath = join(runDir, "pi.log");
    try {
      const promptPath = join(runDir, "prompt.md");
      await writeFile(promptPath, "Reply with exactly OK");
      const result = await supervisePi({
        command: deps.piCommand,
        cwd: repoRoot,
        agentDir: resolve(repoRoot, config.pi.agentDir),
        sessionDir: join(runDir, "sessions"),
        promptPath,
        logPath,
        extensionPaths: [],
        timeoutMs: 120_000,
      });
      if (
        result.exitCode === 0 &&
        !result.timedOut &&
        !result.aborted &&
        result.stdout.includes("OK")
      )
        return undefined;
      return `Pi smoke failed (exit ${result.exitCode}, timeout ${result.timedOut}); log: ${logPath}`;
    } catch (error) {
      return `Pi smoke failed: ${String(error)}; log: ${logPath}`;
    }
  });
  await check("trusted authors", "warn", async () =>
    config.host.trustedAuthors.length
      ? undefined
      : "No trusted authors configured",
  );
  return checks;
}
