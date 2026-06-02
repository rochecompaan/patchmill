#!/usr/bin/env node
import {
  stdin as defaultStdin,
  stdout as defaultStdout,
  cwd,
} from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./args.ts";
import { createCommandRunner } from "../triage/command.ts";
import { GLOBAL_PATCHMILL_SKILLS } from "../../../workflow/skills.ts";
import { createIssueHostProvider } from "../../../host/factory.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { ensureRequiredLabels } from "../labels/setup.ts";
import {
  installProjectSkills,
  validateExistingSkillDirectory,
  type ProjectSkillInstallResult,
} from "./skill-installer.ts";
import {
  configFileExists,
  writeInitialConfig,
  type InitialConfigSkills,
} from "./config-writer.ts";
import { ensurePatchmillLocalExcludeEntries } from "./local-ignore.ts";
import { detectPiReadiness, type PiReadiness } from "./pi-preflight.ts";
import { selectPiModel, type PiModelSelection } from "./pi-model-selection.ts";
import { runPiSmokeTest, type PiSmokeTestResult } from "./pi-smoke-test.ts";

export const HELP_TEXT = `Usage:
  patchmill init [options]

Create a minimal patchmill.config.json for this repository.
Installs the recommended project-local skill pack by default.

Options:
  --skills <mode>  Skill installation mode: project, global, none, or path:<dir>. Default: project.
  --yes            Approve setup prompts for deterministic actions such as label creation.
  --help, -h  Show this help and exit.
`;

export type InitOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type InitPrompt = (question: string) => Promise<string>;
export type PiReadinessDetector = () => PiReadiness;
export type PiSmokeTestRunner = typeof runPiSmokeTest;
export type ProjectSkillInstaller = (options: {
  repoRoot: string;
}) => Promise<ProjectSkillInstallResult>;
export type ExistingSkillDirectoryValidator = (
  repoRoot: string,
  skillDir: string,
) => Promise<InitialConfigSkills>;

const DEFAULT_OUTPUT: InitOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

const HOST_LOGIN_GUIDANCE =
  "To change the default host login later, update `patchmill.config.json` (`host.login`) or set `PATCHMILL_HOST_LOGIN`.";

function defaultPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: defaultStdin, output: defaultStdout });
  return rl.question(question).finally(() => rl.close());
}

const DEFAULT_GLOBAL_SKILLS: InitialConfigSkills = {
  triage: GLOBAL_PATCHMILL_SKILLS.triage,
  planning: GLOBAL_PATCHMILL_SKILLS.planning,
  implementation: GLOBAL_PATCHMILL_SKILLS.implementation,
};

const EXISTING_CONFIG_MESSAGE =
  "patchmill.config.json already exists.\n\nPatchmill did not overwrite it.\n\nNext:\n  patchmill doctor";

function nextSteps(piReady: boolean) {
  return piReady
    ? "Run `patchmill triage --dry-run` to preview issue triage.\n\nNext:\n  patchmill triage --dry-run"
    : "Run `patchmill doctor` after completing Pi setup.\n\nNext:\n  patchmill doctor";
}

function selectedModelFromReadiness(
  readiness: PiReadiness,
): string | undefined {
  return readiness.status === "ready" ? readiness.models[0]?.value : undefined;
}

function formatPiSetupMessage(
  readiness: PiReadiness,
  selection: PiModelSelection,
  smoke: PiSmokeTestResult,
): string {
  const messages = [readiness.message];
  if (readiness.status === "ready" && readiness.warning) {
    messages.push(readiness.warning);
  }
  if (selection.message !== readiness.message) {
    messages.push(selection.message);
  }
  if (smoke.status === "pass") {
    return [...messages, smoke.message].join("\n\n");
  }
  return [
    ...messages,
    "Pi setup is incomplete.",
    smoke.message,
    smoke.details ? `Details:\n${smoke.details}` : undefined,
    "Run `pi`, then `/login` to configure a provider using Pi's native login flow.",
    "After login, run `patchmill doctor`.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function runInit(
  args: string[],
  repoRoot = cwd(),
  output: InitOutput = DEFAULT_OUTPUT,
  options: {
    env?: Record<string, string | undefined>;
    homeDir?: string;
    prompt?: InitPrompt;
    detectPiReadiness?: PiReadinessDetector;
    runPiSmokeTest?: PiSmokeTestRunner;
    isInteractive?: boolean;
    installProjectSkills?: ProjectSkillInstaller;
    validateExistingSkillDirectory?: ExistingSkillDirectoryValidator;
    setupLabels?: typeof ensureRequiredLabels;
  } = {},
): Promise<number> {
  const config = parseArgs(args, repoRoot);
  if (config.showHelp) {
    output.stdout(HELP_TEXT);
    return 0;
  }

  if (await configFileExists(config.repoRoot)) {
    output.stdout(EXISTING_CONFIG_MESSAGE);
    return 1;
  }

  let skills: InitialConfigSkills | undefined;
  let skillsMessage: string;

  if (config.skills.mode === "project") {
    const installResult = await (
      options.installProjectSkills ?? installProjectSkills
    )({ repoRoot: config.repoRoot });
    skills = installResult.skillConfig;
    skillsMessage = `Installed project-local skills:\n  ${installResult.installedSkills.join("\n  ")}\n\nProject-local skills are local-only by default.\n\nUsing Patchmill defaults for labels, paths, and git policy.`;
  } else if (config.skills.mode === "global") {
    skills = DEFAULT_GLOBAL_SKILLS;
    skillsMessage =
      "Using Patchmill default global skill names.\nNo project-local skills were installed.\n\nUsing Patchmill defaults for labels, paths, and git policy.";
  } else if (config.skills.mode === "none") {
    skillsMessage =
      "Skipped default project-local skill installation (--skills none).\nNo skills mapping was written to patchmill.config.json.\n\nUsing Patchmill defaults for labels, paths, and git policy.";
  } else {
    skills = await (
      options.validateExistingSkillDirectory ?? validateExistingSkillDirectory
    )(config.repoRoot, config.skills.path);
    skillsMessage = `Validated existing local skills from ${config.skills.path}.\nNo project-local skills were installed.\n\nUsing Patchmill defaults for labels, paths, and git policy.`;
  }

  const result = await writeInitialConfig(config.repoRoot, { skills });
  if (result.status === "exists") {
    output.stdout(EXISTING_CONFIG_MESSAGE);
    return 1;
  }
  const localExclude = await ensurePatchmillLocalExcludeEntries(
    config.repoRoot,
  );
  const localExcludeMessage = localExclude.skipped
    ? `Warning: Patchmill could not update .git/info/exclude (${localExclude.skipped}).\nAdd .patchmill and patchmill.config.json to your local git excludes to keep the worktree clean.`
    : localExclude.added.length > 0
      ? `Added Patchmill local files to .git/info/exclude:\n  ${localExclude.added.join("\n  ")}`
      : "Patchmill local files were already ignored by .git/info/exclude.";
  const consistencyWarning =
    "Warning: Patchmill config and skills are local-only by default. For consistent Patchmill runs across local machines and CI, consider committing patchmill.config.json and .patchmill/skills/ explicitly.";
  const isInteractive = options.isInteractive ?? defaultStdin.isTTY;

  let labelSetupMessage: string;
  try {
    const runner = createCommandRunner();
    const host = createIssueHostProvider({
      runner,
      repoRoot: config.repoRoot,
      host: result.config.host,
    });
    const policy = createTriagePolicy(
      DEFAULT_PATCHMILL_CONFIG.labels,
      DEFAULT_PATCHMILL_CONFIG.triage,
    );
    const labelSetup = await (options.setupLabels ?? ensureRequiredLabels)({
      host,
      policy,
      prompt: options.prompt ?? defaultPrompt,
      isInteractive,
      assumeYes: config.yes,
      command: "init",
    });
    labelSetupMessage = labelSetup.message;
  } catch (error) {
    labelSetupMessage = [
      `Could not check required labels during init: ${error instanceof Error ? error.message : String(error)}`,
      "You can edit label names in patchmill.config.json after init, then run:",
      "  patchmill doctor --fix",
    ].join("\n");
  }

  const readiness = (options.detectPiReadiness ?? detectPiReadiness)();
  const selection = await selectPiModel({
    readiness,
    isInteractive,
  });
  const smoke =
    selection.status === "unavailable" &&
    selection.reason === "invalid-selection"
      ? {
          status: "fail" as const,
          message:
            "Pi smoke test was not run because model selection was invalid.",
          command: "pi smoke test not run",
          details: selection.message,
        }
      : await (options.runPiSmokeTest ?? runPiSmokeTest)(
          createCommandRunner(),
          {
            repoRoot: config.repoRoot,
            model:
              selection.status === "selected"
                ? selection.model
                : selectedModelFromReadiness(readiness),
          },
        );
  const piReady = smoke.status === "pass";
  const piMessage = formatPiSetupMessage(readiness, selection, smoke);

  output.stdout(
    `Created patchmill.config.json\n\nHost:\n  provider: ${result.config.host.provider}\n  login: ${result.config.host.login}\n\n${HOST_LOGIN_GUIDANCE}\n\n${localExcludeMessage}\n\n${consistencyWarning}\n\n${skillsMessage}\n\n${labelSetupMessage}\n\n${piMessage}\n\n${nextSteps(piReady)}`,
  );
  return 0;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    return await runInit(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  process.exitCode = await main();
}
