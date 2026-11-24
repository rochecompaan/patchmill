import { checkStateWritable } from "../../../state/writable.ts";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PatchmillConfig } from "../../../config/config.ts";
import type { Host } from "../../../host/types.ts";
import { supervisePi } from "../../../kernel/pi-supervisor.ts";
import { resolvePiSubagentsPackageRoot } from "../../../pi/pi-subagents-package.ts";
import { commandOutput, type CommandRunner } from "../../../process/command.ts";
import { stateDir, StateStore } from "../../../state/store.ts";
import { stateTrackingMode } from "../../../kernel/state-tracking-mode.ts";
import type { PiCommandSpec } from "../../pi-cli.ts";
import { checkReviewerRole } from "./reviewer-role.ts";

/** `git merge-tree --write-tree` first appeared in Git 2.38. */
const MIN_GIT = [2, 38] as const;

type ProbeResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

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
    probe: () => Promise<ProbeResult>,
  ) {
    try {
      const result = await probe();
      checks.push({
        name,
        status: result.ok ? "pass" : severity,
        message: result.message ?? "Ready",
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
    // On success, show the message: App-token users need its trust guidance.
    if (result.ok)
      return result.message
        ? { ok: true, message: result.message }
        : { ok: true };
    return { ok: false, message: result.message || "Host CLI check failed" };
  });
  const mode = stateTrackingMode(config);
  switch (mode.doctorWorkflowCheck) {
    case "state":
      await check("state", "fail", async () => {
        await checkStateWritable(repoRoot);
        const cursor = await new StateStore(stateDir(repoRoot)).readCursor();
        return {
          ok: true,
          message: cursor
            ? `Synced up to ${cursor.syncedUpTo}`
            : "Writable, not synced yet",
        };
      });
      break;
    case "labels":
      await check("labels", "fail", async () => {
        const labels = await host.listLabels();
        const missing = Object.values(config.labels).filter(
          (name) => !labels.includes(name),
        );
        return missing.length
          ? { ok: false, message: `Missing labels: ${missing.join(", ")}` }
          : { ok: true };
      });
      break;
    default: {
      const unknown: never = mode.doctorWorkflowCheck;
      throw new Error(`Unknown doctor workflow check: ${String(unknown)}`);
    }
  }
  await check("git", "fail", async () => {
    const result = await runner("git", ["--version"], { cwd: repoRoot });
    const output = commandOutput(result).trim();
    const match = /^git version ((\d+)\.(\d+)\S*)/.exec(
      result.code === 0 ? result.stdout.trim() : "",
    );
    if (!match)
      return { ok: false, message: `Cannot read the Git version: ${output}` };
    const [major, minor] = [Number(match[2]), Number(match[3])];
    return major > MIN_GIT[0] || (major === MIN_GIT[0] && minor >= MIN_GIT[1])
      ? { ok: true }
      : {
          ok: false,
          message: `Git ${MIN_GIT.join(".")} or later is required; found ${match[1]}. Upgrade Git.`,
        };
  });
  await check("excludes", "warn", async () => {
    const warnings: string[] = [];
    for (const path of [
      config.paths.worktreeDir,
      config.paths.runsDir,
      config.pi.agentDir,
      ...mode.ignoredStatePaths,
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
    return warnings.length
      ? { ok: false, message: warnings.join("; ") }
      : { ok: true };
  });
  await check("skills", "fail", async () => {
    const missing = await missingFiles(
      Object.values(config.skills).map((path) =>
        resolve(repoRoot, path, "SKILL.md"),
      ),
    );
    return missing.length
      ? { ok: false, message: `Missing skill files: ${missing.join(", ")}` }
      : { ok: true };
  });
  await check("reviewer", "fail", async () => {
    const result = await checkReviewerRole({
      repoRoot,
      agentDir: config.pi.agentDir,
    });
    return result.ok ? { ok: true } : { ok: false, message: result.message };
  });
  await check("pi-subagents", "fail", async () => {
    resolvePiSubagentsPackageRoot();
    return { ok: true };
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
        return { ok: true };
      return {
        ok: false,
        message: `Pi smoke failed (exit ${result.exitCode}, timeout ${result.timedOut}); log: ${logPath}`,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Pi smoke failed: ${String(error)}; log: ${logPath}`,
      };
    }
  });
  await check("trusted authors", "warn", async () =>
    config.host.trustedAuthors.length
      ? { ok: true }
      : { ok: false, message: "No trusted authors configured" },
  );
  return checks;
}
