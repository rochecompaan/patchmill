import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { CommandFailedError, runCommand } from "../../../process/command.ts";

export const REVIEWER_AGENT = `---
name: reviewer
description: Fresh-context adversarial review of a bounded change
tools: read, grep, find, ls, bash
---

Review the change in a fresh context. Do not trust the implementation summary.
Read the approved scope, base-to-head diff, and relevant source before judging the change.
Look for incorrect behavior, missing tests, unsafe side effects, and scope drift.
Use read-only commands. Do not edit files, install packages, authenticate, or mutate Git or hosting state.
Do not launch agents or execute workflows from installed skills.
Report concrete findings with file paths, line numbers, impact, and supporting evidence.
Separate blockers from optional suggestions. State any limits in the evidence.
`;

export const IMPLEMENTATION_AGENT = `---
name: patchmill-implementation
description: Patchmill implementation worker for one issue
tools: read, grep, find, ls, bash, edit, write, subagent
---

Follow the Patchmill envelope in your task. It defines the work, the rules, and
the final JSON result. The conversation before it is context only.
`;

export async function provisionAgentDir(
  repoRoot: string,
  agentDir: string,
): Promise<void> {
  const directory = join(repoRoot, agentDir, "agents");
  await mkdir(directory, { recursive: true });
  for (const [name, content] of [
    ["reviewer.md", REVIEWER_AGENT],
    ["patchmill-implementation.md", IMPLEMENTATION_AGENT],
  ] as const) {
    const file = join(directory, name);
    let existing: string | undefined;
    try {
      existing = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (existing !== content) await writeFile(file, content);
  }
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
