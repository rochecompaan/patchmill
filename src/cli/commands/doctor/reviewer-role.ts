import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveSubagentLaunchContract } from "pi-subagents/preflight";
import { reviewerAgent } from "../init/agent-dir.ts";

export type ReviewerRoleCheck =
  | { ok: true }
  | { ok: false; repairable: boolean; message: string };

const FORBIDDEN_TOOLS = ["edit", "write", "subagent"];

/**
 * Answers "Does the isolated runtime resolve the managed reviewer?" through
 * the public pi-subagents preflight. Makes no model call and writes no file.
 * Callers must not run another pi-subagents discovery concurrently: the
 * check sets PI_CODING_AGENT_DIR for the call. A preflight error propagates.
 */
export async function checkReviewerRole(input: {
  repoRoot: string;
  agentDir: string;
  timeoutMinutes: number | null;
}): Promise<ReviewerRoleCheck> {
  const agentDir = resolve(input.repoRoot, input.agentDir);
  const managed = resolve(agentDir, "agents", "reviewer.md");
  let content: string;
  try {
    content = await readFile(managed, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      ok: false,
      repairable: true,
      message: `Missing reviewer: ${managed}. Run patchmill doctor --fix.`,
    };
  }
  if (content !== reviewerAgent(input.timeoutMinutes))
    return {
      ok: false,
      repairable: true,
      message: `Stale reviewer: ${managed}. Run patchmill doctor --fix.`,
    };

  const result = await withAgentDir(agentDir, () =>
    resolveSubagentLaunchContract({ agent: "reviewer", cwd: input.repoRoot }),
  );
  if (!result.ok)
    return {
      ok: false,
      repairable: false,
      message: `Reviewer not resolved (${result.code}): ${result.message}`,
    };
  const { agent, tools } = result.contract;
  if ((await realpath(agent.filePath)) !== (await realpath(managed)))
    return {
      ok: false,
      repairable: false,
      message: `Reviewer resolves to ${agent.filePath} (${agent.source}), not ${managed}. Remove or rename that definition.`,
    };
  const effective = tools.effectiveAllowlist;
  if (
    !effective.includes("bash") ||
    effective.some((tool) => FORBIDDEN_TOOLS.includes(tool))
  )
    return {
      ok: false,
      repairable: false,
      message: `Reviewer needs bash and no edit, write or subagent; effective tools: ${effective.join(", ")}`,
    };
  return { ok: true };
}

async function withAgentDir<T>(dir: string, run: () => Promise<T>) {
  const key = "PI_CODING_AGENT_DIR";
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const earlier = process.env[key];
  process.env[key] = dir;
  try {
    return await run();
  } finally {
    if (had) process.env[key] = earlier;
    else delete process.env[key];
  }
}
