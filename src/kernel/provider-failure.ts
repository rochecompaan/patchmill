import fs from "node:fs/promises";
import { join } from "node:path";
import type { ParsedResult } from "./result.ts";

/**
 * A Provider failure: an assistant message that Pi recorded with
 * `stopReason: "error"`. An aborted reply is not one.
 */
export type ProviderFailure = {
  /** The provider's text, trimmed, at most 2000 characters. */
  readonly message: string;
  readonly signIn: boolean;
};

const MAX_MESSAGE = 2000;
const EMPTY_MESSAGE = "The request failed.";
const SIGN_IN_PATTERNS: readonly RegExp[] = [
  /authenticat/i,
  /unauthori[sz]ed/i,
  /\b40[13]\b/i,
  /token (has )?expired|expired token|access token expired/i,
  /invalid (api )?key|api key (is )?(invalid|missing)/i,
  /(log ?in|sign ?in|re-?authenticate).*(again|required|expired)/i,
];
/** The live Web session has a composer and Pause; a history thread may not. */
const THREAD_SIGN_IN_GUIDANCE = {
  live: "The model provider refused the sign-in. Run patchmill auth in the repository, then send your message again. If it fails again, press Pause and then Resume.",
  history:
    "The model provider refused the sign-in. Run patchmill auth in the repository, then try again.",
} as const;

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The message as a sentence: a final period when it has no end mark. */
const sentence = (message: string) =>
  /[.!?]$/.test(message) ? message : `${message}.`;

/** A Pi message object → a Provider failure, or undefined. */
export function providerFailure(message: unknown): ProviderFailure | undefined {
  if (
    !object(message) ||
    message.role !== "assistant" ||
    message.stopReason !== "error"
  )
    return undefined;
  const raw =
    typeof message.errorMessage === "string" ? message.errorMessage.trim() : "";
  const text = Array.from(raw || EMPTY_MESSAGE)
    .slice(0, MAX_MESSAGE)
    .join("");
  return {
    message: text,
    signIn: SIGN_IN_PATTERNS.some((pattern) => pattern.test(text)),
  };
}

/** A Pi message object → the Issue thread error entry, or undefined.
 * `live` is the Web session; `history` is a recorded session file. */
export function providerFailureEntry(
  message: unknown,
  surface: "live" | "history" = "live",
): { title: string; text: string } | undefined {
  const failure = providerFailure(message);
  if (!failure) return undefined;
  return failure.signIn
    ? {
        title: "Sign-in failed",
        text: `${sentence(failure.message)}\n\n${THREAD_SIGN_IN_GUIDANCE[surface]}`,
      }
    : { title: "The agent's request failed", text: sentence(failure.message) };
}

/** The local one-line text for the CLI and triage warnings. */
export function providerFailureNotice(failure: ProviderFailure): string {
  const text = `The model request failed: ${sentence(failure.message)}`;
  return failure.signIn
    ? `${text} Run patchmill auth in the repository.`
    : text;
}

/** The public stop reason. It never holds the provider's message. */
function stopReason(failure: ProviderFailure, issue: number): string {
  return failure.signIn
    ? `The model request failed: the provider refused the sign-in. Run patchmill auth in the repository, then run patchmill run-once --issue ${issue}.`
    : "The model request failed. The CLI output and the log have the provider's message.";
}

async function newestSessionFile(
  sessionDir: string,
): Promise<string | undefined> {
  const entries = await fs.readdir(sessionDir, { withFileTypes: true });
  let newest: { path: string; name: string; mtime: number } | undefined;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const path = join(sessionDir, entry.name);
    const mtime = (await fs.stat(path)).mtimeMs;
    if (
      !newest ||
      mtime > newest.mtime ||
      (mtime === newest.mtime && entry.name > newest.name)
    )
      newest = { path, name: entry.name, mtime };
  }
  return newest?.path;
}

/** The newest session file in `sessionDir`: its last assistant message as a
 * Provider failure, or undefined. Never throws. */
export async function lastProviderFailure(
  sessionDir: string,
): Promise<ProviderFailure | undefined> {
  try {
    const file = await newestSessionFile(sessionDir);
    if (!file) return undefined;
    let last: unknown;
    for (const line of (await fs.readFile(file, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (
        object(entry) &&
        entry.type === "message" &&
        object(entry.message) &&
        entry.message.role === "assistant"
      )
        last = entry.message;
    }
    return providerFailure(last);
  } catch {
    return undefined;
  }
}

/** For a result that did not parse and a session that ended with a Provider
 * failure: the result with the public stop reason, and the failure.
 * Otherwise undefined. */
export async function explainProviderFailure(
  result: ParsedResult,
  sessionDir: string,
  issue: number,
): Promise<{ result: ParsedResult; failure: ProviderFailure } | undefined> {
  if (result.ok) return undefined;
  const failure = await lastProviderFailure(sessionDir);
  if (!failure) return undefined;
  return {
    result: {
      ok: false,
      reason: stopReason(failure, issue),
      ...(result.missing ? { missing: true as const } : {}),
    },
    failure,
  };
}
