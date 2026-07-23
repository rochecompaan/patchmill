export const DEFAULT_TODO_DONE_STATUSES = [
  "closed",
  "completed",
  "complete",
  "done",
] as const;

export const PI_TODO_DONE_STATUSES_ENV = "PI_TODO_DONE_STATUSES";

export function normalizeTodoStatus(status: string): string {
  return status.trim().toLowerCase();
}

export function normalizeTodoDoneStatuses(
  doneStatuses: readonly string[] = DEFAULT_TODO_DONE_STATUSES,
): string[] {
  const normalized: string[] = [];
  for (const status of doneStatuses) {
    const value = normalizeTodoStatus(status);
    if (!value || normalized.includes(value)) continue;
    normalized.push(value);
  }
  return normalized.length > 0 ? normalized : [...DEFAULT_TODO_DONE_STATUSES];
}

export function todoStatusIsDone(
  status: string | undefined,
  doneStatuses: readonly string[] = DEFAULT_TODO_DONE_STATUSES,
): boolean {
  if (status === undefined) return false;
  return normalizeTodoDoneStatuses(doneStatuses).includes(
    normalizeTodoStatus(status),
  );
}

export function serializeTodoDoneStatuses(
  doneStatuses: readonly string[],
): string {
  return JSON.stringify(normalizeTodoDoneStatuses(doneStatuses));
}

export function parseTodoDoneStatusesEnv(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) {
    return [...DEFAULT_TODO_DONE_STATUSES];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_TODO_DONE_STATUSES];
    if (!parsed.every((entry): entry is string => typeof entry === "string")) {
      return [...DEFAULT_TODO_DONE_STATUSES];
    }
    return normalizeTodoDoneStatuses(parsed);
  } catch {
    return [...DEFAULT_TODO_DONE_STATUSES];
  }
}
