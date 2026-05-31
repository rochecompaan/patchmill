import { cwd } from "node:process";

export type DoctorConfig = {
  repoRoot: string;
  showHelp: boolean;
  quiet: boolean;
  fix: boolean;
  yes: boolean;
};

export function parseArgs(args: string[], repoRoot = cwd()): DoctorConfig {
  const config: DoctorConfig = {
    repoRoot,
    showHelp: false,
    quiet: false,
    fix: false,
    yes: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      config.showHelp = true;
    } else if (arg === "--quiet") {
      config.quiet = true;
    } else if (arg === "--fix") {
      config.fix = true;
    } else if (arg === "--yes") {
      config.yes = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (config.yes && !config.fix) {
    throw new Error("--yes can only be used with --fix");
  }

  return config;
}
