export type PiErrorCause = {
  label: string;
  error: unknown;
};

export function errorFromUnknown(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function aggregatePiErrors(
  message: string,
  causes: PiErrorCause[],
): Error | undefined {
  if (causes.length === 0) return undefined;
  if (causes.length === 1) return errorFromUnknown(causes[0].error);
  return new AggregateError(
    causes.map(({ label, error }) => {
      const cause = errorFromUnknown(error);
      return new Error(`${label}: ${cause.message}`, { cause });
    }),
    message,
  );
}

export function appendPiErrorCause(
  error: unknown,
  label: string,
  additionalError: unknown,
): AggregateError {
  const original = errorFromUnknown(error);
  const additional = errorFromUnknown(additionalError);
  const cause = new Error(`${label}: ${additional.message}`, {
    cause: additional,
  });
  const causes =
    original instanceof AggregateError
      ? [...original.errors, cause]
      : [original, cause];
  return new AggregateError(causes, original.message);
}

export function formatErrorWithCauses(error: unknown): {
  message: string;
  causes?: string[];
} {
  const normalized = errorFromUnknown(error);
  if (normalized instanceof AggregateError) {
    return {
      message: normalized.message,
      causes: normalized.errors.map((cause) => errorFromUnknown(cause).message),
    };
  }
  return { message: normalized.message };
}
