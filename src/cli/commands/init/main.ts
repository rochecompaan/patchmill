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
import { writeInitialConfig } from "./config-writer.ts";
import { hasApparentPiProviderConfig } from "./pi-preflight.ts";

export const HELP_TEXT = `Usage:
  patchmill init [options]

Create a minimal patchmill.config.json for this repository.

Options:
  --help, -h  Show this help and exit.
`;

export type InitOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type PiLauncher = () => Promise<number>;
export type InitPrompt = (question: string) => Promise<string>;

const DEFAULT_OUTPUT: InitOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

const NO_PI_PROVIDER_MESSAGE =
  "Patchmill also requires Pi with an LLM provider configured.\nNo provider configuration was detected.";
const MANUAL_PI_SETUP_MESSAGE =
  "To configure manually, run `pi`, then `/login`.";

function defaultPiLauncher(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("pi", [], { stdio: "inherit" });
    child.on("error", () => resolve(-1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function defaultPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: defaultStdin, output: defaultStdout });
  return rl.question(question).finally(() => rl.close());
}

function isYes(value: string): boolean {
  return /^(y|yes)$/iu.test(value.trim());
}

export async function runInit(
  args: string[],
  repoRoot = cwd(),
  output: InitOutput = DEFAULT_OUTPUT,
  options: {
    env?: Record<string, string | undefined>;
    homeDir?: string;
    prompt?: InitPrompt;
    launchPi?: PiLauncher;
    isInteractive?: boolean;
  } = {},
): Promise<number> {
  const config = parseArgs(args, repoRoot);
  if (config.showHelp) {
    output.stdout(HELP_TEXT);
    return 0;
  }

  const result = await writeInitialConfig(config.repoRoot, {});
  if (result.status === "exists") {
    output.stdout(
      `patchmill.config.json already exists.\n\nPatchmill did not overwrite it.\n\nNext:\n  patchmill doctor`,
    );
    return 1;
  }

  const hasPiProvider = await hasApparentPiProviderConfig({
    env: options.env,
    homeDir: options.homeDir,
  });
  let piMessage =
    "Pi provider configuration detected.\nDoctor will verify it with a minimal smoke test.";
  if (!hasPiProvider) {
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

  output.stdout(
    `Created patchmill.config.json\n\nHost:\n  provider: ${result.config.host.provider}\n  login: ${result.config.host.login}\n\nUsing Patchmill defaults for labels, paths, skills, and git policy.\n\n${piMessage}\n\nNext:\n  patchmill doctor`,
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
