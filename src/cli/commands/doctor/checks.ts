import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { loadPatchmillConfigState } from "../../../config/load.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import {
  assertCleanWorktree,
  cleanStatusIgnoredPaths,
} from "../run-once/git.ts";
import { listLabels, listOpenIssues } from "../triage/forgejo.ts";
import { missingLabelDefinitions } from "../triage/labels.ts";
import type { CommandRunner } from "../triage/types.ts";
import type { PatchmillConfig } from "../../../config/types.ts";

export type DoctorCheckStatus = "pass" | "warn" | "fail";

export type DoctorCheckResult = {
  name: string;
  status: DoctorCheckStatus;
  message: string;
  remediation?: string[];
};

type DoctorOptions = {
  repoRoot: string;
  env?: Record<string, string | undefined>;
  teaRepoRootForTests?: string;
};

function pass(name: string, message: string): DoctorCheckResult {
  return { name, status: "pass", message };
}

function warn(name: string, message: string): DoctorCheckResult {
  return { name, status: "warn", message };
}

function fail(
  name: string,
  message: string,
  remediation?: string[],
): DoctorCheckResult {
  return {
    name,
    status: "fail",
    message,
    ...(remediation ? { remediation } : {}),
  };
}

function commandOutput(result: {
  code: number;
  stdout: string;
  stderr: string;
}): string {
  return (
    [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") ||
    "no output"
  );
}

async function checkGit(
  runner: CommandRunner,
  repoRoot: string,
  config?: PatchmillConfig,
): Promise<DoctorCheckResult> {
  const inside = await runner.run(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    { cwd: repoRoot },
  );
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    return fail("git", `not inside a git worktree: ${commandOutput(inside)}`);
  }

  const branch = await runner.run("git", ["branch", "--show-current"], {
    cwd: repoRoot,
  });
  try {
    await assertCleanWorktree(
      runner,
      repoRoot,
      config
        ? cleanStatusIgnoredPaths({
            cleanStatusIgnorePrefixes: config.paths.cleanStatusIgnorePrefixes,
            todoRoot: config.projectPolicy.pi.taskContract.todoRoot,
            runStateDir: config.paths.runStateDir,
          })
        : [],
    );
  } catch (error) {
    return fail("git", error instanceof Error ? error.message : String(error));
  }

  const branchName =
    branch.code === 0 && branch.stdout.trim()
      ? branch.stdout.trim()
      : "detached HEAD";
  return pass("git", `clean worktree on ${branchName}`);
}

async function pathStatus(
  path: string,
): Promise<
  "exists" | "parent-usable" | "missing" | "not-directory" | "unusable"
> {
  const targetStatus = await directoryStatus(path);
  if (targetStatus !== "missing") return targetStatus;

  const parentStatus = await directoryStatus(dirname(path));
  if (parentStatus === "exists") return "parent-usable";
  if (parentStatus === "missing") return "missing";
  return "unusable";
}

async function directoryStatus(
  path: string,
): Promise<"exists" | "missing" | "not-directory" | "unusable"> {
  try {
    const pathStat = await stat(path);
    if (!pathStat.isDirectory()) return "not-directory";
    await access(path, constants.W_OK | constants.X_OK);
    return "exists";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "missing";
    }
    return "unusable";
  }
}

async function checkPiBinary(
  runner: CommandRunner,
  repoRoot: string,
): Promise<DoctorCheckResult> {
  const result = await runner.run("pi", ["--help"], { cwd: repoRoot });
  return result.code === 0
    ? pass("pi", "binary available")
    : fail("pi", `binary unavailable: ${commandOutput(result)}`, [
        "Install Pi, then rerun:",
        "  npm install -g @earendil-works/pi-coding-agent",
        "  patchmill doctor",
      ]);
}

async function checkPiProvider(
  runner: CommandRunner,
  repoRoot: string,
): Promise<DoctorCheckResult> {
  const prompt = "Reply with PATCHMILL_PI_OK and nothing else.";
  const result = await runner.run(
    "pi",
    [
      "--no-session",
      "--no-context-files",
      "--no-prompt-templates",
      "-p",
      prompt,
    ],
    { cwd: repoRoot },
  );
  if (result.code === 0 && result.stdout.includes("PATCHMILL_PI_OK")) {
    return pass("pi provider", "minimal LLM smoke test succeeded");
  }
  return fail("pi provider", "Pi could not complete a minimal LLM smoke test", [
    "Patchmill doctor did not change the repository or issue host.",
    "The Pi check made no Patchmill workflow changes, but it could not reach a configured model provider.",
    "",
    "Configure Pi, then rerun:",
    "  pi",
    "  /login",
    "  patchmill doctor",
    "",
    "Alternatively set a provider API key, for example:",
    "  export ANTHROPIC_API_KEY=sk-ant-...",
    "  patchmill doctor",
  ]);
}

export async function runDoctorChecks(
  runner: CommandRunner,
  options: DoctorOptions,
): Promise<DoctorCheckResult[]> {
  const results: DoctorCheckResult[] = [];
  let loaded;
  try {
    loaded = await loadPatchmillConfigState(
      options.repoRoot,
      options.env ?? process.env,
      [],
    );
    results.push(
      loaded.hasConfigFile
        ? pass("config", "patchmill.config.json")
        : fail("config", "patchmill.config.json not found", [
            "Create local config, then rerun:",
            "  patchmill init",
            "  patchmill doctor",
          ]),
    );
  } catch (error) {
    results.push(
      fail("config", error instanceof Error ? error.message : String(error)),
    );
  }

  results.push(await checkGit(runner, options.repoRoot, loaded?.config));

  if (!loaded) {
    results.push(fail("host", "skipped because config did not load"));
    results.push(fail("issues", "skipped because config did not load"));
    results.push(fail("labels", "skipped because config did not load"));
  } else {
    const config = loaded.config;
    const repoRoot = options.teaRepoRootForTests ?? options.repoRoot;
    if (config.host.provider !== "forgejo-tea") {
      results.push(
        fail("host", `unsupported provider ${config.host.provider}`),
      );
    } else {
      const teaHelp = await runner.run("tea", ["--help"], {
        cwd: options.repoRoot,
      });
      results.push(
        teaHelp.code === 0
          ? pass("host", `forgejo via tea as ${config.host.login}`)
          : fail("host", `tea unavailable: ${commandOutput(teaHelp)}`),
      );
    }

    try {
      const issues = await listOpenIssues(runner, repoRoot, config.host.login);
      results.push(
        pass("issues", `open issues can be listed (${issues.length})`),
      );
    } catch (error) {
      results.push(
        fail("issues", error instanceof Error ? error.message : String(error)),
      );
    }

    try {
      const policy = createTriagePolicy(config.labels, config.triage);
      const missing = missingLabelDefinitions(
        await listLabels(runner, repoRoot, config.host.login),
        policy,
      );
      if (missing.length === 0) {
        results.push(
          pass(
            "labels",
            policy.allowedLabels.map((label) => label.name).join(", "),
          ),
        );
      } else {
        results.push(
          fail(
            "labels",
            `missing ${missing.map((label) => label.name).join(", ")}`,
            [
              "Patchmill doctor is read-only and did not create labels.",
              "",
              "Create the missing labels manually, then rerun:",
              ...missing.map(
                (label) =>
                  `  tea labels create --name ${label.name} --color ${label.color}`,
              ),
              "  patchmill doctor",
            ],
          ),
        );
      }
    } catch (error) {
      results.push(
        fail("labels", error instanceof Error ? error.message : String(error)),
      );
    }

    const skillNames = [
      config.skills.triage,
      config.skills.planning,
      config.skills.implementation,
    ];
    results.push(pass("skills", skillNames.join(", ")));

    const paths = [
      ["plans", config.paths.plansDir],
      ["run-state", config.paths.runStateDir],
      ["triage", config.paths.triageLogDir],
      ["worktree", config.paths.worktreeDir],
    ] as const;
    const statuses = await Promise.all(
      paths.map(async ([name, path]) => `${name}:${await pathStatus(path)}`),
    );
    const hasPathFailures = statuses.some(
      (entry) =>
        entry.endsWith(":not-directory") || entry.endsWith(":unusable"),
    );
    const hasPathWarnings = statuses.some(
      (entry) => entry.endsWith(":missing") || entry.endsWith(":parent-usable"),
    );
    results.push(
      hasPathFailures
        ? fail("paths", statuses.join(", "))
        : hasPathWarnings
          ? warn("paths", statuses.join(", "))
          : pass("paths", statuses.join(", ")),
    );
  }

  results.push(await checkPiBinary(runner, options.repoRoot));
  results.push(await checkPiProvider(runner, options.repoRoot));

  return results;
}
