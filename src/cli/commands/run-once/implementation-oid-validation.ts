import { planningOid } from "../../../git/planning-git-validation.ts";

export type ImplementationOidContext =
  | "pr-created"
  | "merged"
  | "planning-ancestry";
export type ImplementationOidLocation = {
  context: ImplementationOidContext;
  field: string;
  index?: number;
};
export const IMPLEMENTATION_OID_FORMAT =
  "full lowercase 40-character SHA-1 or 64-character SHA-256 commit OID";

export class ImplementationOidValidationError extends Error {
  readonly context: ImplementationOidContext;
  readonly field: string;
  readonly index?: number;
  readonly requiredFormat = IMPLEMENTATION_OID_FORMAT;

  constructor(location: ImplementationOidLocation, options?: ErrorOptions) {
    const field = `${location.field}${location.index === undefined ? "" : `[${location.index}]`}`;
    super(
      `${location.context}.${field} requires ${IMPLEMENTATION_OID_FORMAT}${location.field === "commits" && location.index === undefined ? " in a non-empty array" : ""}`,
      options,
    );
    this.name = "ImplementationOidValidationError";
    this.context = location.context;
    this.field = location.field;
    this.index = location.index;
  }
}

export function findImplementationOidValidationError(
  error: unknown,
): ImplementationOidValidationError | undefined {
  const seen = new Set<Error>();
  let found: ImplementationOidValidationError | undefined;
  while (error instanceof Error && !seen.has(error)) {
    if (error instanceof AggregateError) return undefined;
    seen.add(error);
    if (error instanceof ImplementationOidValidationError) found ??= error;
    error = error.cause;
  }
  return found;
}

export function assertImplementationOid(
  value: unknown,
  location: ImplementationOidLocation,
): asserts value is string {
  if (typeof value !== "string" || !planningOid.test(value)) {
    throw new ImplementationOidValidationError(location);
  }
}

export function parseImplementationCommits(
  value: unknown,
  context: ImplementationOidContext,
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ImplementationOidValidationError({ context, field: "commits" });
  }
  return Array.from(value, (entry: unknown, index) => {
    assertImplementationOid(entry, { context, field: "commits", index });
    return entry;
  });
}
