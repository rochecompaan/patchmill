import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type AgentTeamRole = "worker" | "reviewer";

export type AgentTeamRoleConfig = {
  model: string;
  thinking: string;
};

export type ResolvedAgentTeam = {
  name: string;
  path: string;
  roles: Record<AgentTeamRole, AgentTeamRoleConfig>;
};

type TeamFile = {
  name?: unknown;
  agents?: unknown;
};

const REQUIRED_ROLES: AgentTeamRole[] = ["worker", "reviewer"];

function assertSafeTeamName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(
      "Agent team name must use only letters, numbers, dots, underscores, and hyphens",
    );
  }
}

function teamPaths(repoRoot: string, name: string, homeDir: string): string[] {
  return [
    join(repoRoot, ".pi", "agent-teams", `${name}.json`),
    join(homeDir, ".pi", "agent", "agent-teams", `${name}.json`),
  ];
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseRole(
  teamName: string,
  role: AgentTeamRole,
  value: unknown,
): AgentTeamRoleConfig {
  const record = objectRecord(value);
  if (!record || typeof record.model !== "string" || !record.model.trim()) {
    throw new Error(`Agent team ${teamName} has invalid ${role} model`);
  }

  if (typeof record.thinking !== "string" || !record.thinking.trim()) {
    throw new Error(`Agent team ${teamName} has invalid ${role} thinking`);
  }

  return {
    model: record.model.trim(),
    thinking: record.thinking.trim(),
  };
}

function parseTeam(
  requestedName: string,
  path: string,
  content: string,
): ResolvedAgentTeam {
  let parsed: TeamFile;
  try {
    parsed = JSON.parse(content) as TeamFile;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Agent team ${requestedName} contains invalid JSON: ${message}`);
  }

  const agents = objectRecord(parsed.agents);
  if (!agents) {
    throw new Error(`Agent team ${requestedName} is missing agents`);
  }

  const missing = REQUIRED_ROLES.filter((role) => agents[role] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Agent team ${requestedName} is missing required ${missing.join(", ")} role`,
    );
  }

  return {
    name: typeof parsed.name === "string" ? parsed.name : requestedName,
    path,
    roles: {
      worker: parseRole(requestedName, "worker", agents.worker),
      reviewer: parseRole(requestedName, "reviewer", agents.reviewer),
    },
  };
}

export async function resolveAgentTeam(
  repoRoot: string,
  name: string,
  homeDir = homedir(),
): Promise<ResolvedAgentTeam> {
  assertSafeTeamName(name);
  const paths = teamPaths(repoRoot, name, homeDir);
  for (const path of paths) {
    try {
      const content = await readFile(path, "utf8");
      return parseTeam(name, path, content);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw error;
    }
  }

  throw new Error(
    `Agent team ${name} not found. Searched: ${paths.join(", ")}`,
  );
}
