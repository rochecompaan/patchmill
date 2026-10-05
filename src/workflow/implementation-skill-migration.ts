import { relative, resolve } from "node:path";

const RETIRED = new Set([
  "subagent-dev-with-validation-and-pr-checks",
  "subagent-dev-with-codex-and-thermo-reviews",
  "single-subagent-dev-with-codex-and-thermo-reviews",
]);

/** Returns a retired managed entrypoint name without classifying user-owned paths. */
export function retiredManagedImplementationSkill(
  skill: string,
  repoRoot: string,
): string | undefined {
  const managedRoot = resolve(repoRoot, ".patchmill/skills");
  const resolved = resolve(repoRoot, skill.replaceAll("\\", "/"));
  const local = relative(managedRoot, resolved).replaceAll("\\", "/");
  if (local === "" || local.startsWith("../") || local === "..")
    return undefined;
  const [name, ...rest] = local.split("/");
  if (!name || !RETIRED.has(name)) return undefined;
  if (rest.length === 0 || (rest.length === 1 && rest[0] === "SKILL.md"))
    return name;
  return undefined;
}
