import { cwd } from "node:process";

export type InitConfig = {
  repoRoot: string;
  showHelp: boolean;
};

export function parseArgs(args: string[], repoRoot = cwd()): InitConfig {
  const config: InitConfig = {
    repoRoot,
    showHelp: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      config.showHelp = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return config;
}
