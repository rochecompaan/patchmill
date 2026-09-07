export const planningOid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function isPlanningSingleLine(
  value: unknown,
  maximumLength = 1024,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\0\r\n]/u.test(value)
  );
}

export function isPlanningBranch(value: unknown): value is string {
  return (
    isPlanningSingleLine(value) &&
    !value.startsWith("-") &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !/[\x00-\x20\\~^:?*[]/u.test(value) &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !value.split("/").some((part) => part.length === 0)
  );
}

export function isPlanningArtifactPath(value: unknown): value is string {
  return (
    isPlanningSingleLine(value, 4096) &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  );
}
