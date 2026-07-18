#!/usr/bin/env node
import {
  stdin as defaultStdin,
  stdout as defaultStdout,
  cwd,
} from "node:process";
import { createInterface } from "node:readline/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./args.ts";
import { createCommandRunner } from "../triage/command.ts";
import type { CommandRunner } from "../triage/types.ts";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { GLOBAL_PATCHMILL_SKILLS } from "../../../workflow/skills.ts";
import { createIssueHostProvider } from "../../../host/factory.ts";
import { createPatchmillLabelCatalog } from "../../../policy/label-catalog.ts";
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
import { applyInitGitPolicy, selectInitGitPolicy } from "./git-policy.ts";
import { maybeOfferInitSetupPush } from "./git-setup-push.ts";
import {
  localPiAgentDir,
  readLocalPiDefaultModel,
  writeLocalPiDefaultModel,
} from "./pi-agent-settings.ts";
import { selectModelInteractively as defaultSelectModelInteractively } from "./pi-model-selector.ts";
import type { SelectInteractiveModel } from "./pi-model-selection.ts";
import {
  resolvePiInitSetup as defaultResolvePiInitSetup,
  type PiInitSetupResolver,
  type PiInitSetupResult,
} from "./pi-init-setup.ts";
import { detectPiReadiness, type PiReadiness } from "./pi-preflight.ts";
import { runPiSmokeTest } from "./pi-smoke-test.ts";

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
type MaybePromise<T> = T | Promise<T>;

export type PiReadinessDetector = (options: {
  agentDir: string;
}) => MaybePromise<PiReadiness>;
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
  visualEvidence: GLOBAL_PATCHMILL_SKILLS.visualEvidence!,
};

function stageableSkillRoots(
  skills: InitialConfigSkills | undefined,
): string[] {
  if (!skills) return [];
  const roots = Object.values(skills).flatMap((skill) => {
    if (!skill.includes("/")) return [];
    const root = dirname(skill);
    return root === "." ? [] : [root];
  });
  return [...new Set(roots)];
}

const EXISTING_CONFIG_MESSAGE =
  "patchmill.config.json already exists.\n\nPatchmill did not overwrite it.\n\nNext:\n  patchmill auth\n  patchmill doctor";

function nextSteps(piReady: boolean) {
  return piReady
    ? "Run `patchmill triage` to triage issues.\n\nNext:\n  patchmill triage"
    : "Run `patchmill auth` in an interactive terminal, then run `patchmill doctor`.\n\nNext:\n  patchmill auth\n  patchmill doctor";
}

function formatPiSetupMessage(setup: PiInitSetupResult): string {
  const messages = [setup.readiness.message];
  if (setup.readiness.status === "ready" && setup.readiness.warning) {
    messages.push(setup.readiness.warning);
  }
  if (setup.selection.message !== setup.readiness.message) {
    messages.push(setup.selection.message);
  }
  if (setup.status === "ready") {
    return [...messages, setup.smoke.message].join("\n\n");
  }
  if (setup.status === "cancelled" || setup.status === "invalid") {
    return messages.join("\n\n");
  }
  return [
    ...messages,
    "Pi provider/model setup is incomplete.",
    setup.smoke.message,
    setup.smoke.details ? `Details:\n${setup.smoke.details}` : undefined,
    "Run `patchmill auth` in an interactive terminal to configure provider auth and select a model.",
    "After setup, run `patchmill doctor`.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function shouldAbortPiSetup(setup: PiInitSetupResult): boolean {
  return setup.status === "cancelled" || setup.status === "invalid";
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
    selectModelInteractively?: SelectInteractiveModel;
    resolvePiInitSetup?: PiInitSetupResolver;
    installProjectSkills?: ProjectSkillInstaller;
    validateExistingSkillDirectory?: ExistingSkillDirectoryValidator;
    setupLabels?: typeof ensureRequiredLabels;
    commandRunner?: CommandRunner;
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
    skillsMessage = `Installed project-local skills:\n  ${installResult.installedSkills.join("\n  ")}\n\nUsing Patchmill defaults for labels, paths, and git policy.`;
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
  const isInteractive = options.isInteractive ?? defaultStdin.isTTY;
  const commandRunner = options.commandRunner ?? createCommandRunner();
  const gitPolicy = await selectInitGitPolicy({
    isInteractive,
    assumeYes: config.yes,
    prompt: options.prompt ?? defaultPrompt,
  });
  const gitPolicyResult = await applyInitGitPolicy({
    repoRoot: config.repoRoot,
    policy: gitPolicy,
    runner: commandRunner,
    skillRoots: stageableSkillRoots(result.config.skills),
  });
  const setupPushResult =
    gitPolicyResult.setupCommit?.status === "committed"
      ? await maybeOfferInitSetupPush({
          repoRoot: config.repoRoot,
          runner: commandRunner,
          remote: DEFAULT_PATCHMILL_CONFIG.git.remote,
          baseBranch: DEFAULT_PATCHMILL_CONFIG.git.baseBranch,
          isInteractive,
          assumeYes: config.yes,
          prompt: options.prompt ?? defaultPrompt,
        })
      : undefined;
  const gitPolicyMessage = [gitPolicyResult.message, setupPushResult?.message]
    .filter((message): message is string => Boolean(message))
    .join("\n\n");
  const piAgentDir = localPiAgentDir(config.repoRoot);
  let currentDefault: Awaited<ReturnType<typeof readLocalPiDefaultModel>> =
    undefined;
  let settingsWarning: string | undefined;
  let settingsWriteWarning: string | undefined;
  try {
    currentDefault = await readLocalPiDefaultModel(piAgentDir);
  } catch (error) {
    settingsWarning = `Could not read local Pi settings: ${error instanceof Error ? error.message : String(error)}`;
  }

  let labelSetupMessage: string;
  try {
    const runner = createCommandRunner();
    const host = createIssueHostProvider({
      runner,
      repoRoot: config.repoRoot,
      host: result.config.host,
    });
    const labelConfig = {
      ...DEFAULT_PATCHMILL_CONFIG,
      host: result.config.host,
      skills: { ...DEFAULT_PATCHMILL_CONFIG.skills, ...result.config.skills },
    };
    const labelCatalog = createPatchmillLabelCatalog(labelConfig);
    const labelSetup = await (options.setupLabels ?? ensureRequiredLabels)({
      host,
      labelCatalog,
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

  const readiness = await (options.detectPiReadiness ?? detectPiReadiness)({
    agentDir: piAgentDir,
  });
  const persistDefaultModel = settingsWarning
    ? undefined
    : async (model: Parameters<typeof writeLocalPiDefaultModel>[1]) => {
        try {
          await writeLocalPiDefaultModel(piAgentDir, model);
        } catch (error) {
          settingsWriteWarning = `Could not save local Pi default model: ${error instanceof Error ? error.message : String(error)}`;
        }
      };
  const piSetup = await (
    options.resolvePiInitSetup ?? defaultResolvePiInitSetup
  )({
    repoRoot: config.repoRoot,
    piAgentDir,
    readiness,
    isInteractive,
    currentDefault,
    selectModelInteractively:
      options.selectModelInteractively ?? defaultSelectModelInteractively,
    persistDefaultModel,
    runPiSmokeTest: options.runPiSmokeTest,
  });
  const piReady = piSetup.status === "ready";
  const piMessage = formatPiSetupMessage(piSetup);
  const piSettingsWarnings = [settingsWarning, settingsWriteWarning]
    .filter((warning): warning is string => Boolean(warning))
    .join("\n\n");
  const piSettingsMessage = piSettingsWarnings
    ? `${piSettingsWarnings}\n\n`
    : "";

  output.stdout(
    `Created patchmill.config.json\n\nHost:\n  provider: ${result.config.host.provider}\n  login: ${result.config.host.login}\n\n${HOST_LOGIN_GUIDANCE}\n\n${gitPolicyMessage}\n\n${skillsMessage}\n\n${labelSetupMessage}\n\n${piSettingsMessage}${piMessage}\n\n${nextSteps(piReady)}`,
  );
  return shouldAbortPiSetup(piSetup) ? 1 : 0;
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
