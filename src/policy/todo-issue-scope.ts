export const PI_TODO_ISSUE_SCOPE_ENV = "PI_TODO_ISSUE_SCOPE";

export type TodoIssueScope = { titlePattern?: string; tags: string[] };

export function parseTodoIssueScope(
  raw: string | undefined,
): TodoIssueScope | undefined {
  if (raw === undefined) return undefined;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Issue todo scope");
  const scope = value as Record<string, unknown>;
  if (
    Object.keys(scope).some((key) => !["titlePattern", "tags"].includes(key)) ||
    !Array.isArray(scope.tags) ||
    !scope.tags.every((tag) => typeof tag === "string" && tag.length > 0)
  )
    throw new Error("Invalid Issue todo scope");
  if (scope.titlePattern !== undefined) {
    if (
      typeof scope.titlePattern !== "string" ||
      scope.titlePattern.length > 4096 ||
      !scope.titlePattern.startsWith("^") ||
      !scope.titlePattern.endsWith("$")
    )
      throw new Error("Invalid Issue todo scope title pattern");
    new RegExp(scope.titlePattern);
  }
  if (scope.titlePattern === undefined && scope.tags.length === 0)
    throw new Error("Issue todo scope requires an issue-specific title or tag");
  return scope as TodoIssueScope;
}

export function todoMatchesIssueScope(
  todo: { title: string; tags: readonly string[] },
  scope: TodoIssueScope | undefined,
): boolean {
  return (
    scope === undefined ||
    (scope.titlePattern !== undefined &&
      new RegExp(scope.titlePattern).test(todo.title)) ||
    (scope.tags.length > 0 &&
      scope.tags.every((tag) => todo.tags.includes(tag)))
  );
}
