import { cwd } from "node:process";

export type DoctorConfig = {
  repoRoot: string;
  showHelp: boolean;
  quiet: boolean;
};

export function parseArgs(args: string[], repoRoot = cwd()): DoctorConfig {
  const config: DoctorConfig = {
    repoRoot,
    showHelp: false,
    quiet: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      config.showHelp = true;
    } else if (arg === "--quiet") {
      config.quiet = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return config;
}
