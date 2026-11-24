import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  registerRequiredChildExtensions,
  type RequiredChildExtensionRegistration,
} from "pi-subagents/required-child-extensions";
import type { PatchmillConfig } from "../config/config.ts";

/** Seconds. 0 means off. */
export type CommandLimits = { defaultSeconds: number; maxSeconds: number };

/**
 * The Pi extension that gives each agent `bash` call a Command timeout. It
 * has the extension of this module: `.ts` from source, `.js` from `dist`.
 */
export const COMMAND_TIMEOUT_EXTENSION_PATH = fileURLToPath(
  new URL(
    `./command-timeout-extension${extname(fileURLToPath(import.meta.url))}`,
    import.meta.url,
  ),
);
export const COMMAND_TIMEOUT_ENV = "PATCHMILL_COMMAND_TIMEOUT_SECONDS";
export const MAX_COMMAND_TIMEOUT_ENV = "PATCHMILL_MAX_COMMAND_TIMEOUT_SECONDS";
const EXTENSION_ID = "patchmill-command-timeout";
const BUILT_IN: CommandLimits = { defaultSeconds: 1200, maxSeconds: 1500 };
/** Pi rejects a `bash` timeout above 2^31 - 1 ms. */
const MAX_SECONDS = Math.floor((2 ** 31 - 1) / 1000);
const DUPLICATE = "are already registered for session";

export function commandLimits(pi: PatchmillConfig["pi"]): CommandLimits {
  return {
    defaultSeconds: pi.commandTimeoutMinutes * 60,
    maxSeconds: pi.maxCommandTimeoutMinutes * 60,
  };
}

/** The environment that carries the limits to a Pi process and its runners. */
export function commandLimitsEnv(
  limits: CommandLimits,
): Record<string, string> {
  return {
    [COMMAND_TIMEOUT_ENV]: String(limits.defaultSeconds),
    [MAX_COMMAND_TIMEOUT_ENV]: String(limits.maxSeconds),
  };
}

function readSeconds(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  const text = env[name];
  if (text === undefined) return fallback;
  const value = text.trim() === "" ? Number.NaN : Number(text);
  if (!Number.isFinite(value) || value < 0 || value > MAX_SECONDS)
    throw new Error(
      `${name} must be a number of seconds from 0 to ${MAX_SECONDS}; found "${text}".`,
    );
  return value;
}

/** A missing variable gives the built-in limit. An invalid one throws. */
export function readCommandLimits(env: NodeJS.ProcessEnv): CommandLimits {
  return {
    defaultSeconds: readSeconds(
      env,
      COMMAND_TIMEOUT_ENV,
      BUILT_IN.defaultSeconds,
    ),
    maxSeconds: readSeconds(env, MAX_COMMAND_TIMEOUT_ENV, BUILT_IN.maxSeconds),
  };
}

/**
 * The timeout that a `bash` call runs with. An invalid request stays
 * unchanged, so Pi rejects it with its own message.
 */
export function limitCommandTimeout(
  timeout: number | null | undefined,
  limits: CommandLimits,
): number | undefined {
  const cap = limits.maxSeconds > 0 ? limits.maxSeconds : Infinity;
  // A model can send an explicit null for an omitted optional argument.
  if (timeout === undefined || timeout === null)
    return limits.defaultSeconds > 0
      ? Math.min(limits.defaultSeconds, cap)
      : undefined;
  if (!Number.isFinite(timeout) || timeout <= 0) return timeout;
  return Math.min(timeout, cap);
}

export function createCommandTimeoutExtension(options: {
  limits: CommandLimits;
  register?: typeof registerRequiredChildExtensions;
}): ExtensionFactory {
  const register = options.register ?? registerRequiredChildExtensions;
  return (pi: ExtensionAPI): void => {
    let registration: RequiredChildExtensionRegistration | undefined;
    pi.on("tool_call", (event) => {
      if (!isToolCallEventType("bash", event)) return;
      const requested = event.input.timeout as number | null | undefined;
      const timeout = limitCommandTimeout(requested, options.limits);
      if (timeout === undefined) delete event.input.timeout;
      else event.input.timeout = timeout;
    });
    pi.on("session_start", (_event, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId();
      try {
        // Children of this session load this file, also with `extensions: []`.
        registration = register({
          sessionId,
          extensions: [
            { id: EXTENSION_ID, path: COMMAND_TIMEOUT_EXTENSION_PATH },
          ],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes(DUPLICATE)) throw error;
        console.error(
          `Command timeout: child extensions for session ${sessionId} are already registered. Keeping them.`,
        );
      }
    });
    pi.on("session_shutdown", () => {
      registration?.dispose();
      registration = undefined;
    });
  };
}

/** Reads the environment when Pi loads the extension, not on import. */
export default function commandTimeoutExtension(pi: ExtensionAPI): void {
  createCommandTimeoutExtension({ limits: readCommandLimits(process.env) })(pi);
}
