import { cwd } from "node:process";

export type InitSkillsMode =
  | { mode: "project" }
  | { mode: "global" }
  | { mode: "none" }
  | { mode: "path"; path: string };

export type InitConfig = {
  repoRoot: string;
  showHelp: boolean;
  skills: InitSkillsMode;
};

const SKILLS_VALUE_ERROR =
  "--skills requires one of project, global, none, or path:<dir>";
const SKILLS_PATH_ERROR = "--skills path:<dir> requires a non-empty directory";

function parseSkillsMode(value: string): InitSkillsMode {
  if (value === "project") {
    return { mode: "project" };
  }
  if (value === "global") {
    return { mode: "global" };
  }
  if (value === "none") {
    return { mode: "none" };
  }
  if (value.startsWith("path:")) {
    const path = value.slice("path:".length).trim();
    if (!path) {
      throw new Error(SKILLS_PATH_ERROR);
    }
    return { mode: "path", path };
  }
  throw new Error(SKILLS_VALUE_ERROR);
}

function requireSkillsValue(args: string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(SKILLS_VALUE_ERROR);
  }
  return value;
}

export function parseArgs(args: string[], repoRoot = cwd()): InitConfig {
  const config: InitConfig = {
    repoRoot,
    showHelp: false,
    skills: { mode: "project" },
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      config.showHelp = true;
    } else if (arg === "--skills") {
      config.skills = parseSkillsMode(requireSkillsValue(args, index));
      index += 1;
    } else if (arg.startsWith("--skills=")) {
      const value = arg.slice("--skills=".length);
      if (value === "") {
        throw new Error(SKILLS_VALUE_ERROR);
      }
      config.skills = parseSkillsMode(value);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return config;
}
