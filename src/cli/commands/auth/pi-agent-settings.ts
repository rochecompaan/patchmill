import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type LocalPiDefaultModel = {
  provider: string;
  modelId: string;
};

export function localPiAgentDir(repoRoot: string): string {
  return join(repoRoot, ".patchmill", "pi-agent");
}

export function piAgentEnv(agentDir: string): Record<string, string> {
  return { PI_CODING_AGENT_DIR: agentDir };
}

function settingsPath(agentDir: string): string {
  return join(agentDir, "settings.json");
}

async function readSettings(path: string): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("settings.json must contain a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }
    throw new Error(
      `Could not parse local Pi settings: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export async function readLocalPiDefaultModel(
  agentDir: string,
): Promise<LocalPiDefaultModel | undefined> {
  const settings = await readSettings(settingsPath(agentDir));
  return typeof settings.defaultProvider === "string" &&
    typeof settings.defaultModel === "string"
    ? { provider: settings.defaultProvider, modelId: settings.defaultModel }
    : undefined;
}

export async function writeLocalPiDefaultModel(
  agentDir: string,
  model: LocalPiDefaultModel,
): Promise<void> {
  const path = settingsPath(agentDir);
  const settings = await readSettings(path);
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        ...settings,
        defaultProvider: model.provider,
        defaultModel: model.modelId,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
