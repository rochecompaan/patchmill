export const CONFIG_FILE_NAME = "patchmill.config.json";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return String(value);
}

export function configError(
  path: string,
  expected: string,
  value: unknown,
): Error {
  return new Error(
    `Invalid ${CONFIG_FILE_NAME}: ${path} must be ${expected}; received ${describeValue(value)}`,
  );
}

export function readOptionalSection(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw configError(key, "an object", value);
  return value;
}

export function readOptionalString(
  source: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw configError(path, "a string", value);
  return value;
}

export function readOptionalBoolean(
  source: Record<string, unknown>,
  key: string,
  path: string,
): boolean | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw configError(path, "a boolean", value);
  return value;
}

export function readOptionalPositiveInteger(
  source: Record<string, unknown>,
  key: string,
  path: string,
): number | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw configError(path, "a positive integer", value);
  }
  return value;
}

export function readOptionalStringArray(
  source: Record<string, unknown>,
  key: string,
  path: string,
): string[] | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw configError(path, "an array of strings", value);
  }
  return [...value];
}

export function readOptionalLiteral<T extends string>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly [T, ...T[]],
): T | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    const expected =
      allowed.length === 1
        ? `the literal ${JSON.stringify(allowed[0])}`
        : `one of ${allowed.map((entry) => JSON.stringify(entry)).join(", ")}`;
    throw configError(path, expected, value);
  }
  return value as T;
}

export function hasEntries(value: object): boolean {
  return Object.keys(value).length > 0;
}
