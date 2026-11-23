import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { CommandFailedError, runCommand } from "../../../process/command.ts";

export const REVIEWER_AGENT = `---
name: reviewer
description: Fresh-context adversarial review of a bounded change
tools: read, grep, find, ls, bash
---

You are a fresh-context reviewer. Your task contains the review brief: a template or brief, any appendix, the scope, and the inputs.
Follow the brief completely. It defines what to check, how to judge, and the report format with every required section.
Steps in the brief that are addressed to the parent or the implementer are not yours.
This role adds the tool and safety limits below. When the brief is stricter than a limit, obey the brief.
In a brief, "read-only" means: no edits to tracked files and no Git or hosting changes, except a disposable worktree that the brief permits. Ignored build output and caches from validation commands are not changes.
Do not trust summaries from the implementer or the planner. Read the scope, the diff or documents, and the relevant source yourself.

Tool and safety limits:
- You may use bash to run the project's validation commands: tests, lint, format checks, type checks, and builds.
- You may run read-only Git commands, such as git status, git diff, git log, and git show.
- These commands can write ignored build output or caches. That is permitted.
- If the brief permits a disposable worktree in a temporary directory, you may create it. Remove it before you finish.
- Do not run commands that fix or rewrite files, such as --fix, --write, or a formatter in write mode.
- Do not edit files, install packages, or authenticate.
- Do not change Git or hosting state, except a disposable worktree that the brief permits.
- Do not launch agents. Read installed skill files when the brief tells you to. Do not start their workflows.
- Run git status --short before and after your commands. Report each change that your commands caused, with the brief's command evidence or inspection limits. If the brief has neither, add one line after its report.

If the brief gives no report format, report concrete findings with file paths, line numbers, impact, and evidence.
Separate blockers from optional suggestions, and state the limits of your evidence.
If the runtime also asks for an acceptance report, put it after the complete report that the brief requires.
`;

export const IMPLEMENTATION_AGENT = `---
name: patchmill-implementation
description: Patchmill implementation worker for one issue
tools: read, grep, find, ls, bash, edit, write, subagent, bg_wait, subagent_supervisor
---

Follow the Patchmill envelope in your task. It defines the work, the rules, and
the final JSON result. The conversation before it is context only.
`;

export async function provisionAgentDir(
  repoRoot: string,
  agentDir: string,
  skillPaths: string[] = [],
): Promise<void> {
  const skills = loadSkills({
    cwd: repoRoot,
    agentDir: resolve(repoRoot, agentDir),
    skillPaths,
    includeDefaults: false,
  }).skills;
  const implementation = skillPaths.length
    ? IMPLEMENTATION_AGENT.replace(
        "tools: read",
        `skills: ${skills.map((skill) => skill.name).join(", ")}\nskillPath: ${skillPaths.join(", ")}\ntools: read`,
      )
    : IMPLEMENTATION_AGENT;
  await provisionReviewerAgent(repoRoot, agentDir);
  await writeWhenDifferent(
    resolve(repoRoot, agentDir, "agents", "patchmill-implementation.md"),
    implementation,
  );
}

/**
 * Writes the managed reviewer definition when it is missing or different.
 * Touches no other file in the agent directory.
 */
export async function provisionReviewerAgent(
  repoRoot: string,
  agentDir: string,
): Promise<"written" | "unchanged"> {
  const directory = resolve(repoRoot, agentDir, "agents");
  await mkdir(directory, { recursive: true });
  return (await writeWhenDifferent(
    join(directory, "reviewer.md"),
    REVIEWER_AGENT,
  ))
    ? "written"
    : "unchanged";
}

async function writeWhenDifferent(
  file: string,
  content: string,
): Promise<boolean> {
  let existing: string | undefined;
  try {
    existing = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing === content) return false;
  await writeFile(file, content);
  return true;
}

export async function ensureLocalExcludes(
  repoRoot: string,
  patterns: string[],
): Promise<string[]> {
  const args = ["rev-parse", "--git-path", "info/exclude"];
  const result = await runCommand("git", args, { cwd: repoRoot });
  if (result.code !== 0) throw new CommandFailedError("git", args, result);
  const file = resolve(repoRoot, result.stdout.trim());
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const lines = new Set(existing.split(/\r?\n/));
  const missing = [...new Set(patterns)].filter(
    (pattern) => !lines.has(pattern),
  );
  if (missing.length) {
    await mkdir(dirname(file), { recursive: true });
    const separator = existing && !existing.endsWith("\n") ? "\n" : "";
    await writeFile(file, `${existing}${separator}${missing.join("\n")}\n`);
  }
  return missing;
}
