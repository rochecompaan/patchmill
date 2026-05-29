#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  stdin as defaultStdin,
  stdout as defaultStdout,
  cwd,
} from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./args.ts";
import { DEFAULT_PATCHMILL_SKILLS } from "../../../workflow/skills.ts";
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
import { hasApparentPiProviderConfig } from "./pi-preflight.ts";

export const HELP_TEXT = `Usage:
  patchmill init [options]

Create a minimal patchmill.config.json for this repository.
Installs the recommended project-local skill pack by default.

Options:
  --skills <mode>  Skill installation mode: project, global, none, or path:<dir>. Default: project.
  --help, -h  Show this help and exit.
`;

export type InitOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type PiLauncher = () => Promise<number>;
export type PiAvailabilityCheck = () => Promise<boolean>;
export type InitPrompt = (question: string) => Promise<string>;
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

const NO_PI_PROVIDER_MESSAGE =
  "Patchmill also requires Pi with an LLM provider configured.\nNo provider configuration was detected.";
const MANUAL_PI_SETUP_MESSAGE =
  "To configure manually, run `pi`, then `/login`.";
const NO_PI_BINARY_MESSAGE =
  "Pi does not appear to be installed, so Patchmill did not offer to launch it.\n\nInstall Pi, then configure a provider:\n  npm install -g @earendil-works/pi-coding-agent\n  pi\n  /login";
const HOST_LOGIN_GUIDANCE =
  "To change the default host login later, update `patchmill.config.json` (`host.login`) or set `PATCHMILL_HOST_LOGIN`.";

function defaultPiLauncher(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("pi", [], { stdio: "inherit" });
    child.on("error", () => resolve(-1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function defaultPiAvailabilityCheck(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("pi", ["--help"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function defaultPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: defaultStdin, output: defaultStdout });
  return rl.question(question).finally(() => rl.close());
}

function isYes(value: string): boolean {
  return /^(y|yes)$/iu.test(value.trim());
}

const DEFAULT_GLOBAL_SKILLS: InitialConfigSkills = {
  triage: DEFAULT_PATCHMILL_SKILLS.triage,
  planning: DEFAULT_PATCHMILL_SKILLS.planning,
  implementation: DEFAULT_PATCHMILL_SKILLS.implementation,
};

const EXISTING_CONFIG_MESSAGE =
  "patchmill.config.json already exists.\n\nPatchmill did not overwrite it.\n\nNext:\n  patchmill doctor";

export async function runInit(
  args: string[],
  repoRoot = cwd(),
  output: InitOutput = DEFAULT_OUTPUT,
  options: {
    env?: Record<string, string | undefined>;
    homeDir?: string;
    prompt?: InitPrompt;
    launchPi?: PiLauncher;
    checkPiAvailable?: PiAvailabilityCheck;
    isInteractive?: boolean;
    installProjectSkills?: ProjectSkillInstaller;
    validateExistingSkillDirectory?: ExistingSkillDirectoryValidator;
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
    skillsMessage = `Installed project-local skills:\n  ${installResult.installedSkills.join("\n  ")}\n\nCommit ${installResult.skillDir}/ to share the recommended skill pack with this repository.\n\nUsing Patchmill defaults for labels, paths, and git policy.`;
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

  const hasPiProvider = await hasApparentPiProviderConfig({
    env: options.env,
    homeDir: options.homeDir,
  });
  let piMessage =
    "Pi provider configuration detected.\nDoctor will verify it with a minimal smoke test.";
  if (!hasPiProvider) {
    const piAvailable = await (
      options.checkPiAvailable ?? defaultPiAvailabilityCheck
    )();
    if (!piAvailable) {
      piMessage = `${NO_PI_PROVIDER_MESSAGE}\n\n${NO_PI_BINARY_MESSAGE}`;
    } else {
      const isInteractive = options.isInteractive ?? defaultStdin.isTTY;
      if (isInteractive) {
        output.stdout(NO_PI_PROVIDER_MESSAGE);
        const answer = await (options.prompt ?? defaultPrompt)(
          "Open Pi now to configure a provider with `/login`? [y/N] ",
        );
        if (isYes(answer)) {
          const code = await (options.launchPi ?? defaultPiLauncher)();
          if (code === 0) {
            piMessage = "Returned from Pi provider setup.";
          } else {
            piMessage = `${code === -1 ? "Patchmill could not launch Pi." : "Pi exited before provider setup could be confirmed."}\n\n${MANUAL_PI_SETUP_MESSAGE}`;
          }
        } else {
          piMessage = MANUAL_PI_SETUP_MESSAGE;
        }
      } else {
        piMessage = `${NO_PI_PROVIDER_MESSAGE}\n\n${MANUAL_PI_SETUP_MESSAGE}`;
      }
    }
  }

  output.stdout(
    `Created patchmill.config.json\n\nHost:\n  provider: ${result.config.host.provider}\n  login: ${result.config.host.login}\n\n${HOST_LOGIN_GUIDANCE}\n\n${skillsMessage}\n\n${piMessage}\n\nNext:\n  patchmill doctor`,
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
