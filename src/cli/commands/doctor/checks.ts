import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { localPiAgentDir, piAgentEnv } from "../init/pi-agent-settings.ts";
import { runPiSmokeTest } from "../init/pi-smoke-test.ts";
import { loadPatchmillConfigState } from "../../../config/load.ts";
import { createIssueHostProvider } from "../../../host/factory.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import {
  assertCleanWorktree,
  cleanStatusIgnoredPaths,
} from "../run-once/git.ts";
import { missingLabelDefinitions } from "../triage/labels.ts";
import type { CommandRunner } from "../triage/types.ts";
import type { PatchmillConfig } from "../../../config/types.ts";
import {
  DEFAULT_PATCHMILL_SKILLS,
  PATCHMILL_SKILL_KEYS,
  bundledTriageSkillPath,
  isPathLikeSkill,
  resolveConfiguredSkillInvocation,
  resolvePathLikeSkillPath,
} from "../../../workflow/skills.ts";

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

type SkillCheckEntry = {
  status: DoctorCheckStatus;
  summary: string;
};

const PROJECT_LOCAL_SKILLS_PROMPT =
  "Reply with PATCHMILL_SKILLS_OK and nothing else.";

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
  piAgentDir: string,
): Promise<DoctorCheckResult> {
  const result = await runPiSmokeTest(runner, { repoRoot, piAgentDir });
  if (result.status === "pass") {
    return pass("pi provider", "minimal LLM smoke test succeeded");
  }
  return fail(
    "pi provider",
    "Pi could not complete a minimal LLM smoke test",
    [
      "Patchmill doctor did not change the repository or issue host.",
      "The Pi check made no Patchmill workflow changes, but it could not reach a configured model provider.",
      "",
      "Run Patchmill's guided setup, then rerun doctor:",
      "  patchmill init",
      "  patchmill doctor",
      "",
      "Manual Pi setup is also supported:",
      "  pi",
      "  /login",
      "  patchmill doctor",
      "",
      result.details ? `Details: ${result.details}` : "",
    ].filter(Boolean),
  );
}

async function checkReadableSkillTarget(path: string): Promise<boolean> {
  try {
    const pathStat = await stat(path);
    await access(
      path,
      pathStat.isDirectory() ? constants.R_OK | constants.X_OK : constants.R_OK,
    );
    return true;
  } catch {
    return false;
  }
}

function parseSkillFrontmatter(
  text: string,
): { name: string; description: string } | { error: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) {
    return { error: "missing frontmatter" };
  }

  const values = new Map<string, string>();
  const continuationLines = new Map<string, string[]>();
  let currentKey: string | undefined;
  let currentValueAllowsContinuation = false;

  for (const line of match[1].split(/\r?\n/u)) {
    const trimmed = line.trim();

    if (/^[^\s].*:/u.test(line)) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        currentKey = undefined;
        currentValueAllowsContinuation = false;
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      values.set(key, value);
      continuationLines.set(key, []);
      currentKey = key;
      currentValueAllowsContinuation =
        value.length === 0 || /^[>|]/u.test(value);
      continue;
    }

    if (
      currentKey &&
      currentValueAllowsContinuation &&
      (/^[ \t]/u.test(line) || trimmed.length === 0)
    ) {
      continuationLines.get(currentKey)?.push(trimmed);
      continue;
    }

    if (!trimmed || trimmed.startsWith("#")) continue;

    currentKey = undefined;
    currentValueAllowsContinuation = false;
  }

  for (const [key, value] of values) {
    if (value.length > 0 && !/^[>|]/u.test(value)) continue;

    const continuation = (continuationLines.get(key) ?? []).join("\n").trim();
    values.set(key, continuation);
  }

  const missing = ["name", "description"].filter((key) => !values.get(key));
  if (missing.length > 0) {
    return { error: `missing ${missing.join(" and ")}` };
  }

  return {
    name: values.get("name") ?? "",
    description: values.get("description") ?? "",
  };
}

async function validateResolvedLocalSkill(
  label: string,
  configuredPath: string,
  resolvedPath: string,
): Promise<SkillCheckEntry> {
  try {
    const pathStat = await stat(resolvedPath);
    if (!pathStat.isFile()) {
      return {
        status: "fail",
        summary: `${label}: \`${configuredPath}\` (configured path unreadable at ${resolvedPath})`,
      };
    }

    await access(resolvedPath, constants.R_OK);
    const content = await readFile(resolvedPath, "utf8");
    const frontmatter = parseSkillFrontmatter(content);
    if ("error" in frontmatter) {
      return {
        status: "fail",
        summary: `${label}: \`${configuredPath}\` (malformed skill frontmatter: ${frontmatter.error} at ${resolvedPath})`,
      };
    }

    return {
      status: "pass",
      summary: `${label}: \`${configuredPath}\` (path verified)`,
    };
  } catch {
    return {
      status: "fail",
      summary: `${label}: \`${configuredPath}\` (configured path unreadable at ${resolvedPath})`,
    };
  }
}

async function smokeTestProjectLocalSkills(
  runner: CommandRunner,
  repoRoot: string,
  skillPaths: string[],
  piAgentDir: string,
): Promise<SkillCheckEntry> {
  const result = await runner.run(
    "pi",
    [
      "--no-session",
      "--no-context-files",
      "--no-prompt-templates",
      ...skillPaths.flatMap((path) => ["--skill", path]),
      "-p",
      PROJECT_LOCAL_SKILLS_PROMPT,
    ],
    { cwd: repoRoot, env: piAgentEnv(piAgentDir) },
  );

  if (result.code === 0 && result.stdout.includes("PATCHMILL_SKILLS_OK")) {
    return {
      status: "pass",
      summary: "Pi loaded configured local skills",
    };
  }

  return {
    status: "fail",
    summary: `Pi could not load the configured local skills: ${commandOutput(result)}`,
  };
}

async function checkSkills(
  runner: CommandRunner,
  config: PatchmillConfig,
  repoRoot: string,
  piAgentDir: string,
): Promise<DoctorCheckResult> {
  const configuredSkills = PATCHMILL_SKILL_KEYS.flatMap((key) => {
    const skill = config.skills[key];
    return skill ? [{ key, skill }] : [];
  });
  const configuredSkillValues = PATCHMILL_SKILL_KEYS.flatMap((key) => {
    const skill = config.skills[key];
    return skill ? [skill] : [];
  });
  const resolution = resolveConfiguredSkillInvocation(
    configuredSkillValues,
    repoRoot,
  );

  const entries: SkillCheckEntry[] = await Promise.all(
    configuredSkills.map(async ({ key, skill }) => {
      if (key === "triage" && skill === DEFAULT_PATCHMILL_SKILLS.triage) {
        const bundledPath = bundledTriageSkillPath();
        return (await checkReadableSkillTarget(bundledPath))
          ? {
              status: "pass" as const,
              summary: `${key}: \`${skill}\` (bundled skill verified)`,
            }
          : {
              status: "fail" as const,
              summary: `${key}: \`${skill}\` (bundled skill unreadable at ${bundledPath})`,
            };
      }

      if (!isPathLikeSkill(skill)) {
        return {
          status: "warn" as const,
          summary: `${key}: \`${skill}\` (named skill configured; doctor did not verify it)`,
        };
      }

      const resolvedPath = resolvePathLikeSkillPath(skill, repoRoot);
      return validateResolvedLocalSkill(key, skill, resolvedPath);
    }),
  );

  entries.push(...resolution.diagnostics);

  if (
    resolution.usedProjectLocalPack &&
    !entries.some((entry) => entry.status === "fail") &&
    resolution.paths.length > 0
  ) {
    entries.push(
      await smokeTestProjectLocalSkills(
        runner,
        repoRoot,
        resolution.paths,
        piAgentDir,
      ),
    );
  }

  const message = entries.map((entry) => entry.summary).join("; ");
  if (entries.some((entry) => entry.status === "fail")) {
    return fail("skills", message, [
      "Patchmill doctor only verifies bundled skills and path-like configured skills.",
      "Fix missing or unreadable skill paths, then rerun:",
      "  patchmill doctor",
    ]);
  }
  if (entries.some((entry) => entry.status === "warn")) {
    return warn("skills", message);
  }
  return pass("skills", message);
}

export async function runDoctorChecks(
  runner: CommandRunner,
  options: DoctorOptions,
): Promise<DoctorCheckResult[]> {
  const results: DoctorCheckResult[] = [];
  const piAgentDir = localPiAgentDir(options.repoRoot);
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
    const hostRepoRoot = options.teaRepoRootForTests ?? options.repoRoot;
    const host = createIssueHostProvider({
      runner,
      repoRoot: hostRepoRoot,
      host: config.host,
    });
    const cliCheck = await host.checkCli();
    results.push(
      cliCheck.ok
        ? pass("host", cliCheck.message)
        : fail("host", cliCheck.message, cliCheck.remediation),
    );

    try {
      const issues = await host.listOpenIssues();
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
      const missing = missingLabelDefinitions(await host.listLabels(), policy);
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
              "Run the approved repair flow:",
              "  patchmill doctor --fix",
              "",
              "You can edit label names in patchmill.config.json before running --fix.",
            ],
          ),
        );
      }
    } catch (error) {
      results.push(
        fail("labels", error instanceof Error ? error.message : String(error)),
      );
    }

    results.push(
      await checkSkills(runner, config, options.repoRoot, piAgentDir),
    );

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
  results.push(await checkPiProvider(runner, options.repoRoot, piAgentDir));

  return results;
}
