import {
  isPlanningArtifactPath,
  isPlanningBranch,
  isPlanningSingleLine,
  planningOid,
} from "../git/planning-git-validation.ts";
import type { PlanningPhaseKind } from "./planning-pull-request-markers.ts";

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
export class PlanningStateValidationError extends Error {
  readonly reason: string;
  readonly path: string;
  readonly statePath?: string;
  constructor(reason: string, path: string, statePath?: string) {
    super(`Planning state is invalid: ${reason} at ${path}`);
    this.name = "PlanningStateValidationError";
    this.reason = reason;
    this.path = path;
    if (statePath !== undefined) this.statePath = statePath;
  }
}
export const fail = (reason: string, path: string): never => {
  throw new PlanningStateValidationError(reason, path);
};
export const object = (
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> => objectWithOptionalKeys(value, keys, [], path);
export const objectWithOptionalKeys = (
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  path: string,
): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("expected-object", path);
  const result = value as Record<string, unknown>;
  const allowedKeys = [...requiredKeys, ...optionalKeys];
  for (const key of Object.keys(result))
    if (!allowedKeys.includes(key)) fail("unknown-key", `${path}.${key}`);
  for (const key of requiredKeys)
    if (!(key in result)) fail("missing-key", `${path}.${key}`);
  return result;
};
export const string = (
  value: unknown,
  path: string,
  reason = "invalid-string",
): string => (typeof value === "string" ? value : fail(reason, path));
export const positive = (value: unknown, path: string): number =>
  Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : fail("invalid-positive-integer", path);
export const nonnegative = (value: unknown, path: string): number =>
  Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : fail("invalid-nonnegative-integer", path);
export const oid = (value: unknown, path: string): string => {
  const parsed = string(value, path);
  return planningOid.test(parsed) ? parsed : fail("invalid-oid", path);
};
export const singleLine = (value: unknown, path: string): string => {
  const parsed = string(value, path);
  return isPlanningSingleLine(parsed) ? parsed : fail("invalid-string", path);
};
export const nonblankSingleLine = (value: unknown, path: string): string => {
  const parsed = singleLine(value, path);
  return parsed.trim().length > 0 ? parsed : fail("invalid-string", path);
};
export const branch = (value: unknown, path: string): string => {
  const parsed = string(value, path);
  return isPlanningBranch(parsed) ? parsed : fail("invalid-branch", path);
};
export const artifactPath = (value: unknown, path: string): string => {
  const parsed = string(value, path);
  return isPlanningArtifactPath(parsed) ? parsed : fail("invalid-path", path);
};
export function timestamp(value: unknown, path: string): string {
  const parsed = string(value, path);
  return ISO_TIMESTAMP.test(parsed) &&
    !Number.isNaN(Date.parse(parsed)) &&
    new Date(parsed).toISOString() === parsed
    ? parsed
    : fail("invalid-timestamp", path);
}
export function phase(value: unknown, path: string): PlanningPhaseKind {
  const parsed = string(value, path);
  return parsed === "spec" || parsed === "plan" || parsed === "implementation"
    ? parsed
    : fail("invalid-phase", path);
}

export function safeUrl(value: unknown, path: string): string {
  const url = string(value, path);
  try {
    const parsedUrl = new URL(url);
    if (
      (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
      parsedUrl.username ||
      parsedUrl.password ||
      parsedUrl.search ||
      parsedUrl.hash ||
      /[\r\n]/u.test(url)
    )
      fail("invalid-url", path);
  } catch (error) {
    if (error instanceof PlanningStateValidationError) throw error;
    fail("invalid-url", path);
  }
  return url;
}

export function nonnegativeFinite(value: unknown, path: string): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fail("invalid-nonnegative-number", path);
}
