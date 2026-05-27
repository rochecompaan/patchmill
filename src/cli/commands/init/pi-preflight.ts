import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const PI_PROVIDER_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "CLOUDFLARE_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_API_KEY",
  "ZAI_API_KEY",
  "OPENCODE_API_KEY",
  "HF_TOKEN",
  "FIREWORKS_API_KEY",
  "KIMI_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CN_API_KEY",
  "XIAOMI_API_KEY",
  "XIAOMI_TOKEN_PLAN_CN_API_KEY",
  "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
] as const;

type Env = Record<string, string | undefined>;

function hasProviderEnv(env: Env): boolean {
  return PI_PROVIDER_ENV_VARS.some((key) => (env[key]?.trim().length ?? 0) > 0);
}

function hasAuthEntries(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

export async function hasApparentPiProviderConfig(
  options: {
    env?: Env;
    homeDir?: string;
  } = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  if (hasProviderEnv(env)) return true;

  const authPath = join(
    options.homeDir ?? homedir(),
    ".pi",
    "agent",
    "auth.json",
  );
  try {
    return hasAuthEntries(
      JSON.parse(await readFile(authPath, "utf8")) as unknown,
    );
  } catch {
    return false;
  }
}
